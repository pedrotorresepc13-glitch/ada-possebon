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

class AdaIntegrationService
{
    private static function config(): array
    {
        $file = 'app/config/ada.php';
        if (!is_file($file)) {
            throw new RuntimeException('Integração ADA não configurada (app/config/ada.php ausente).');
        }
        $cfg = require $file;
        foreach (['sso_secret', 'service_token_sha256', 'ada_url', 'issuer', 'audience'] as $k) {
            if (empty($cfg[$k])) throw new RuntimeException("Configuração ADA incompleta: {$k}");
        }
        if (strlen($cfg['sso_secret']) < 32) throw new RuntimeException('sso_secret deve ter ao menos 32 caracteres.');
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
        $userId = (int) TSession::getValue('userid');
        $unitId = (int) TSession::getValue('userunitid');
        if ($userId <= 0 || $unitId <= 0) {
            throw new RuntimeException('Sessão do POSSEBON sem usuário/unidade.');
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
        return $bearer !== '' && hash_equals($cfg['service_token_sha256'], hash('sha256', $bearer));
    }

    /**
     * Contrato v1 (docs/openapi-possebon-identity.yaml).
     * ATENÇÃO: confirmar no baseline vivo se há exceções/escopos adicionais (ex.: vínculo por
     * Colaborador/Pessoa usado pelo AppApiBearerMiddleware) antes de considerar a regra completa.
     */
    public static function resolveIdentity(PDO $conn, int $userId): ?array
    {
        $u = $conn->prepare("SELECT id, name, login, active FROM system_users WHERE id = :id");
        $u->execute([':id' => $userId]);
        $user = $u->fetch(PDO::FETCH_ASSOC);
        if (!$user) return null;

        $units = $conn->prepare(
            "SELECT su.id, su.name
               FROM system_user_unit suu
               JOIN system_unit su ON su.id = suu.system_unit_id
              WHERE suu.system_user_id = :id
              ORDER BY su.name"
        );
        $units->execute([':id' => $userId]);
        $unitRows = $units->fetchAll(PDO::FETCH_ASSOC);

        $groups = $conn->prepare(
            "SELECT g.id, g.name
               FROM system_user_group ug
               JOIN system_group g ON g.id = ug.system_group_id
              WHERE ug.system_user_id = :id"
        );
        $groups->execute([':id' => $userId]);
        $groupRows = $groups->fetchAll(PDO::FETCH_ASSOC);

        // Programas por grupo (com ações) + programas atribuídos diretamente ao usuário.
        $programs = [];
        $gp = $conn->prepare(
            "SELECT p.controller, gp.actions
               FROM system_user_group ug
               JOIN system_group_program gp ON gp.system_group_id = ug.system_group_id
               JOIN system_program p ON p.id = gp.system_program_id
              WHERE ug.system_user_id = :id"
        );
        $gp->execute([':id' => $userId]);
        foreach ($gp->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $actions = self::parseActions($row['actions']);
            $programs[$row['controller']] = array_values(array_unique(array_merge($programs[$row['controller']] ?? [], $actions)));
        }
        $up = $conn->prepare(
            "SELECT p.controller
               FROM system_user_program up
               JOIN system_program p ON p.id = up.system_program_id
              WHERE up.system_user_id = :id"
        );
        $up->execute([':id' => $userId]);
        foreach ($up->fetchAll(PDO::FETCH_COLUMN) as $controller) {
            $programs[$controller] = $programs[$controller] ?? ['*'];
        }

        // Escopo gerencial: DECISÃO DE NEGÓCIO PENDENTE. Padrão conservador e controlado no POSSEBON:
        // usuários com o programa "AdaGestor" têm escopo gerencial nas unidades vinculadas.
        // Alternativa a validar: gerencia.gerente_id / equipe.responsavel_id por unit_id.
        $managerUnits = isset($programs['AdaGestor']) ? array_map(fn($r) => (int) $r['id'], $unitRows) : [];

        $payload = [
            'system_user_id'   => (int) $user['id'],
            'login'            => (string) $user['login'],
            'name'             => (string) $user['name'],
            'active'           => ($user['active'] === 'Y'),
            'units'            => array_map(fn($r) => ['id' => (int) $r['id'], 'name' => (string) $r['name']], $unitRows),
            'groups'           => array_map(fn($r) => ['id' => (int) $r['id'], 'name' => (string) $r['name']], $groupRows),
            'programs'         => array_map(fn($c, $a) => ['controller' => $c, 'actions' => $a], array_keys($programs), array_values($programs)),
            'manager_unit_ids' => $managerUnits,
        ];
        $payload['permissions_version'] = substr(hash('sha256', json_encode($payload)), 0, 16);
        return $payload;
    }

    /** system_group_program.actions pode ser JSON, CSV ou nulo conforme versão do MAD Builder — validar no baseline. */
    private static function parseActions($raw): array
    {
        if ($raw === null || $raw === '') return ['*'];
        $j = json_decode((string) $raw, true);
        if (is_array($j)) return array_values(array_filter(array_map('strval', $j)));
        return array_values(array_filter(array_map('trim', explode(',', (string) $raw))));
    }
}
