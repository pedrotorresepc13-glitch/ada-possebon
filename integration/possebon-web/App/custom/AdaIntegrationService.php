<?php
/**
 * =============================================================================
 * PROPOSTA — NÃO APLICADA. Integração POSSEBON Web → ADA POSSEBON.
 * Validar contra o baseline VIVO (ZIP mais recente) antes de copiar para o servidor.
 * Ver integration/possebon-web/README.md e docs/ADA_INTEGRACAO_POSSEBON.md.
 * =============================================================================
 *
 * Responsabilidades:
 *  1. emitir ticket SSO de curta duração (≤ 60 s), uso único (jti), com audiência "ada-possebon";
 *  2. resolver identidade/permissões AUTORITATIVAS de um usuário para o endpoint servidor-servidor.
 *
 * Segredos ficam em app/config/ada.php (NÃO versionado). Nada aqui grava em tabelas do MAD Builder.
 */

use Firebase\JWT\JWT;

final class AdaIntegrationService
{
    private static function config(): array
    {
        $file = 'app/config/ada.php';
        if (!is_file($file)) throw new RuntimeException('Integracao ADA nao configurada.');
        $cfg = require $file;
        if (!is_array($cfg)) throw new RuntimeException('Configuracao ADA invalida.');
        foreach (['sso_secret', 'service_token_sha256', 'ada_url', 'issuer', 'audience'] as $key) {
            if (!is_string($cfg[$key] ?? null) || $cfg[$key] === '') {
                throw new RuntimeException('Configuracao ADA incompleta.');
            }
        }
        if (strlen($cfg['sso_secret']) < 32 ||
            !preg_match('/^[a-f0-9]{64}$/i', $cfg['service_token_sha256'])) {
            throw new RuntimeException('Segredos da ADA invalidos.');
        }
        if (!preg_match('~^https://[^/]+/ada$~i', rtrim($cfg['ada_url'], '/'))) {
            throw new RuntimeException('Endereco HTTPS da ADA invalido.');
        }
        return $cfg;
    }

    public static function adaUrl(): string
    {
        return rtrim(self::config()['ada_url'], '/');
    }

    /**
     * Ticket assinado HS256 para o usuário logado NA SESSÃO do POSSEBON Web.
     * Nunca recebe user/unidade do navegador: usa TSession do Adianti.
     */
    public static function issueTicketForCurrentSession(): string
    {
        if (TSession::getValue('logged') !== true) {
            throw new RuntimeException('Usuario nao autenticado no POSSEBON Web.');
        }
        $userId = filter_var(TSession::getValue('userid'), FILTER_VALIDATE_INT);
        $unitId = filter_var(TSession::getValue('userunitid'), FILTER_VALIDATE_INT);
        if (!$userId || $userId < 1 || !$unitId || $unitId < 1) {
            throw new RuntimeException('Usuario ou unidade ativa ausente.');
        }
        $allowedUnits = TSession::getValue('userunitids');
        if (!is_array($allowedUnits) ||
            !in_array((int) $unitId, array_map('intval', $allowedUnits), true)) {
            throw new RuntimeException('Unidade nao vinculada ao usuario.');
        }
        $programs = TSession::getValue('programs');
        if (!is_array($programs) ||
            (!isset($programs['AdaAcesso']) && !isset($programs['AdaAdministracao']))) {
            throw new RuntimeException('Usuario sem permissao para ADA.');
        }
        $cfg = self::config();
        $now = time();
        $claims = [
            'iss'     => $cfg['issuer'],          // "possebon-web"
            'aud'     => $cfg['audience'],        // "ada-possebon"
            'sub'     => (string) $userId,
            'unit_id' => $unitId,
            'jti'     => bin2hex(random_bytes(16)),
            'iat'     => $now,
            'exp'     => $now + 60,
        ];
        return JWT::encode($claims, $cfg['sso_secret'], 'HS256');
    }

    /** Valida o token técnico EXCLUSIVO da ADA (não reutiliza o token do Mail Import). */
    public static function serviceTokenValid(string $bearer): bool
    {
        $cfg = self::config();
        return $bearer !== '' && strlen($bearer) <= 512 && hash_equals($cfg['service_token_sha256'], hash('sha256', $bearer));
    }

    /**
     * Contrato v1 (docs/openapi-possebon-identity.yaml).
     * ATENÇÃO: confirmar no baseline vivo se há exceções/escopos adicionais (ex.: vínculo por
     * Colaborador/Pessoa usado pelo AppApiBearerMiddleware) antes de considerar a regra completa.
     */
    public static function resolveIdentity(PDO $conn, int $userId): ?array
    {
        if ($userId < 1) return null;
        $stmt = $conn->prepare('SELECT id,name,login,active FROM system_users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user) return null;

        $stmt = $conn->prepare(
            'SELECT DISTINCT su.id,su.name FROM system_user_unit uu
              JOIN system_unit su ON su.id=uu.system_unit_id
             WHERE uu.system_user_id=:id ORDER BY su.id'
        );
        $stmt->execute([':id'=>$userId]);
        $units = array_map(static fn($u) => ['id'=>(int)$u['id'],'name'=>(string)$u['name']],
            $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);

        $stmt = $conn->prepare(
            'SELECT DISTINCT g.id,g.name FROM system_user_group ug
              JOIN system_group g ON g.id=ug.system_group_id
             WHERE ug.system_user_id=:id ORDER BY g.id'
        );
        $stmt->execute([':id'=>$userId]);
        $groups = array_map(static fn($g) => ['id'=>(int)$g['id'],'name'=>(string)$g['name']],
            $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);

        // system_program.actions contém objetos {"action":"..."}.
        // system_group_program.actions contém os nomes permitidos por grupo.
        // Um vínculo direto system_user_program concede acesso ao programa,
        // mas NÃO eleva automaticamente as permissões de suas ações.
        $stmt = $conn->prepare(
            'SELECT p.controller,p.actions AS configured_actions,gp.actions AS allowed_actions
               FROM system_user_group ug
               JOIN system_group_program gp ON gp.system_group_id=ug.system_group_id
               JOIN system_program p ON p.id=gp.system_program_id
              WHERE ug.system_user_id=:id ORDER BY p.controller,gp.id'
        );
        $stmt->execute([':id'=>$userId]);
        $programs = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $grant) {
            $controller = (string)($grant['controller'] ?? '');
            if (!self::validController($controller)) continue;
            $configured = self::parseActions($grant['configured_actions'] ?? null, true);
            $allowed = self::parseActions($grant['allowed_actions'] ?? null, false);
            $actions = array_values(array_intersect($configured, $allowed));
            $programs[$controller] = array_values(array_unique(array_merge($programs[$controller] ?? [], $actions)));
        }
        $stmt = $conn->prepare(
            'SELECT p.controller FROM system_user_program up
             JOIN system_program p ON p.id=up.system_program_id
             WHERE up.system_user_id=:id ORDER BY p.controller'
        );
        $stmt->execute([':id'=>$userId]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $controller) {
            if (self::validController((string)$controller)) {
                $programs[(string)$controller] = $programs[(string)$controller] ?? [];
            }
        }
        ksort($programs);
        $managerUnitIds = isset($programs['AdaGestor']) ? array_column($units,'id') : [];
        $payload = [
            'system_user_id'=>(int)$user['id'],
            'login'=>(string)$user['login'],
            'name'=>(string)$user['name'],
            'active'=>strtoupper((string)$user['active']) === 'Y',
            'units'=>$units,'groups'=>$groups,
            'programs'=>array_map(static fn($controller,$actions)=>[
                'controller'=>$controller,'actions'=>$actions
            ],array_keys($programs),array_values($programs)),
            'manager_unit_ids'=>$managerUnitIds,
        ];
        $payload['permissions_version'] = substr(hash('sha256',json_encode($payload,JSON_UNESCAPED_UNICODE)),0,16);
        return $payload;
    }

    private static function validController(string $name): bool
    {
        return (bool)preg_match('/^[A-Za-z0-9_]{1,120}$/D',$name);
    }

    /** Nunca trata ações ausentes como '*'. */
    private static function parseActions($raw, bool $definitions): array
    {
        if (!is_string($raw) || trim($raw) === '') return [];
        $decoded = json_decode($raw,true);
        if (!is_array($decoded) || !array_is_list($decoded)) return [];
        $out = [];
        foreach ($decoded as $item) {
            $action = $definitions && is_array($item) ? ($item['action'] ?? null) : $item;
            if (is_string($action) && preg_match('/^[A-Za-z0-9_:-]{1,120}$/D',$action)) {
                $out[$action] = true;
            }
        }
        return array_keys($out);
    }
}
