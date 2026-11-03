<?php
/** Ponte same-origin para o botão global. Nenhuma consulta de negócio ou chamada de IA. */
final class AdaAssistantBridge
{
    public static function respond(): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, private');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        try {
            $method = $_SERVER['REQUEST_METHOD'] ?? '';
            if (!in_array($method, ['GET', 'POST'], true)) {
                header('Allow: GET, POST');
                self::send(405, ['error' => 'Método não permitido.']);
                return;
            }
            // Bloqueia inclusive GET de outra origem antes de divulgar metadados da sessão.
            if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && $_SERVER['HTTP_SEC_FETCH_SITE'] !== 'same-origin') {
                self::send(403, ['error' => 'Origem não autorizada.']);
                return;
            }
            $user = filter_var(TSession::getValue('userid'), FILTER_VALIDATE_INT);
            $unit = filter_var(TSession::getValue('userunitid'), FILTER_VALIDATE_INT);
            $units = TSession::getValue('userunitids');
            $programs = TSession::getValue('programs');
            if (TSession::getValue('logged') !== true || !$user || $user < 1 || !$unit || $unit < 1) {
                self::send(401, ['allowed' => false]);
                return;
            }
            if (!is_array($units) || !in_array((int) $unit, array_map('intval', $units), true)
                || !is_array($programs) || (!isset($programs['AdaEmbedView']) && !isset($programs['AdaAdministracao']))) {
                self::send(403, ['allowed' => false]);
                return;
            }
            $ada = AdaIntegrationService::adaUrl();
            $parts = parse_url($ada);
            if (!$parts || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])
                || isset($parts['query']) || isset($parts['fragment'])) {
                throw new RuntimeException('Endereço da assistente inválido.');
            }
            $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
            if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $origin) {
                self::send(403, ['error' => 'A assistente deve usar a mesma origem do POSSEBON.']);
                return;
            }
            $nonce = TSession::getValue('ada_assistant_csrf');
            if (!is_string($nonce) || !preg_match('/^[a-f0-9]{64}$/D', $nonce)) {
                $nonce = bin2hex(random_bytes(32));
                TSession::setValue('ada_assistant_csrf', $nonce);
            }
            if ($method === 'GET') {
                self::send(200, ['allowed' => true, 'baseUrl' => $ada . '/', 'userId' => (int) $user,
                    'unitId' => (int) $unit, 'csrf' => $nonce]);
                return;
            }
            $csrf = $_SERVER['HTTP_X_POSSEBON_CSRF'] ?? '';
            if (!is_string($csrf) || !hash_equals($nonce, $csrf)) {
                self::send(403, ['error' => 'Sessão de integração expirada.']);
                return;
            }
            // O emissor existente verifica novamente sessão/unidade/programa. A API revalida a identidade autoritativa.
            $ticket = AdaIntegrationService::issueTicketForCurrentSession();
            self::send(200, ['action' => $ada . '/api/ada/session/exchange', 'ticket' => $ticket]);
        } catch (Throwable $e) {
            error_log('POSSEBON global assistant: ' . get_class($e));
            self::send(503, ['error' => 'A assistente está indisponível. Tente novamente.']);
        }
    }

    private static function send(int $status, array $body): void
    {
        http_response_code($status);
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
