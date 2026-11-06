<?php
/**
 * PROPOSTA — NÃO APLICADA. Endpoint servidor-servidor consumido SOMENTE pela ADA:
 *   GET /api/ada/v1/identity?system_user_id=<id>
 *   Authorization: Bearer <token técnico exclusivo da ADA>
 * Deve ser acessível apenas a partir do servidor da ADA (restringir também no Apache).
 */

use Mad\Rest\Request;
use Mad\Rest\Response;

require_once 'app/custom/AdaIntegrationService.php';

trait AdaIdentityApiTrait
{
    public function identidadeAda(Request $request)
    {
        try {
            $auth = trim((string) $request->getAuthToken());
            $bearer = stripos($auth, 'Bearer ') === 0 ? trim(substr($auth, 7)) : '';
            if (!AdaIntegrationService::serviceTokenValid($bearer)) {
                return (new Response())->json(['status' => 'error', 'error' => 'Não autorizado.'], 401);
            }
            $userId = filter_var($request->get('system_user_id'), FILTER_VALIDATE_INT);
            if (!$userId || $userId < 1) {
                return (new Response())->json(['status' => 'error', 'error' => 'system_user_id inválido.'], 422);
            }
            $group = $request->get('group_members');
            $unit = filter_var($request->get('unit_id'), FILTER_VALIDATE_INT);
            if ($group !== null && (!is_string($group) || !preg_match('/^[A-Za-z0-9_. -]{1,120}$/D', $group) || !$unit || $unit < 1)) {
                return (new Response())->json(['error' => 'Grupo ou unidade inválidos.'], 422);
            }
            TTransaction::open('permission');
            TTransaction::get()->exec('SET TRANSACTION READ ONLY');
            $payload = AdaIntegrationService::resolveIdentity(TTransaction::get(), $userId);
            if ($group !== null) {
                $allowed = $payload && $payload['active'] &&
                    in_array($unit, array_column($payload['units'], 'id'), true) &&
                    in_array('AdaAdministracao', array_column($payload['programs'], 'controller'), true);
                if (!$allowed) {
                    TTransaction::close();
                    return (new Response())->json(['error' => 'Administração autorizada nesta unidade é necessária.'], 403);
                }
                $db = TTransaction::get();
                $stmt = $db->prepare('SELECT id FROM system_group WHERE name = :name LIMIT 2');
                $stmt->execute(['name' => $group]);
                $groups = $stmt->fetchAll(PDO::FETCH_COLUMN);
                if (count($groups) !== 1) {
                    TTransaction::close();
                    return (new Response())->json(['error' => 'Grupo não identificado de forma inequívoca.'], 404);
                }
                $stmt = $db->prepare('SELECT DISTINCT u.id, u.name, u.login
                    FROM system_users u
                    JOIN system_user_group ug ON ug.system_user_id = u.id
                    JOIN system_user_unit uu ON uu.system_user_id = u.id
                    WHERE ug.system_group_id = :group_id AND uu.system_unit_id = :unit_id
                      AND UPPER(u.active) = \'Y\'
                    ORDER BY u.name, u.id LIMIT 501');
                $stmt->execute(['group_id' => $groups[0], 'unit_id' => $unit]);
                $members = $stmt->fetchAll(PDO::FETCH_ASSOC);
                TTransaction::close();
                return (new Response())->json(['group' => $group, 'unitId' => $unit,
                    'members' => array_map(static fn($row) => ['name' => $row['name'], 'login' => $row['login']], array_slice($members, 0, 500)),
                    'truncated' => count($members) > 500]);
            }
            TTransaction::close();
            if (!$payload) {
                return (new Response())->json(['status' => 'error', 'error' => 'Usuário não encontrado.'], 404);
            }
            return (new Response())->json($payload);
        } catch (Throwable $e) {
            if (TTransaction::get()) TTransaction::rollback();
            error_log('ADA identity - ' . $e->getMessage());
            return (new Response())->json(['status' => 'error', 'error' => 'Falha ao resolver identidade.'], 503);
        }
    }
}
