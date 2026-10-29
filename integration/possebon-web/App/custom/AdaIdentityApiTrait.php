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
            TTransaction::open('permission');
            TTransaction::get()->exec('SET TRANSACTION READ ONLY');
            $payload = AdaIntegrationService::resolveIdentity(TTransaction::get(), $userId);
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
