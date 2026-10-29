<?php
/**
 * ADA POSSEBON — endpoint exclusivo de LEITURA do Brain vivo.
 * Nunca reutiliza o token do Mail Import, nunca recebe SQL, não executa sync/DDL.
 * O usuário e a unidade são validados no banco permission a cada chamada.
 *
 * POST /api/ada/v1/brain/context
 * Authorization: Bearer <POSSEBON_SERVICE_TOKEN exclusivo da ADA>
 * JSON: {system_user_id:int, unit_id:int, question:string, limit?:int, namespaces?:string[]}
 *
 * NÃO instalar antes da configuração segura e da validação do SSO.
 */
use Mad\Rest\Request;
use Mad\Rest\Response;

require_once 'app/custom/AdaIntegrationService.php';

trait AdaBrainApiTrait
{
    public function contextoBrainAda(Request $request)
    {
        try {
            $authorization = trim((string) $request->getAuthToken());
            if (!preg_match('/^Bearer\s+([A-Za-z0-9._~-]+)$/i', $authorization, $match) ||
                !AdaIntegrationService::serviceTokenValid($match[1])) {
                return (new Response())->json(['status' => 'error', 'error' => 'Nao autorizado.'], 401);
            }

            $userId = filter_var($request->get('system_user_id'), FILTER_VALIDATE_INT);
            $unitId = filter_var($request->get('unit_id'), FILTER_VALIDATE_INT);
            $question = trim((string) ($request->get('question') ?? ''));
            $limit = filter_var($request->get('limit') ?? 8, FILTER_VALIDATE_INT);

            if (!$userId || $userId < 1 || !$unitId || $unitId < 1 ||
                $question === '' || mb_strlen($question) > 300 ||
                $limit === false || $limit < 1 || $limit > 8) {
                return (new Response())->json(['status' => 'error', 'error' => 'Consulta invalida.'], 422);
            }

            $requested = $request->get('namespaces');
            if ($requested === null) $requested = ['rule', 'model', 'schema'];
            if (!is_array($requested) || count($requested) < 1 || count($requested) > 4) {
                return (new Response())->json(['status' => 'error', 'error' => 'Namespaces invalidos.'], 422);
            }

            // Validacao autoritativa: nenhuma identidade/permissao deriva de claims do navegador.
            TTransaction::open('permission');
            $db = TTransaction::get();
            $db->exec('SET TRANSACTION READ ONLY');
            $identity = AdaIntegrationService::resolveIdentity($db, (int) $userId);
            TTransaction::close();

            $programs = [];
            if ($identity && !empty($identity['programs'])) {
                foreach ($identity['programs'] as $p) {
                    $programs[(string) ($p['controller'] ?? '')] = true;
                }
            }
            $isAdmin = isset($programs['AdaAdministracao']);
            $isTechnical = isset($programs['AdaConhecimentoTecnico']);

            if (!$identity || !$identity['active'] || (!$isAdmin && !$isTechnical)) {
                return (new Response())->json(['status' => 'error', 'error' => 'Acesso nao autorizado.'], 403);
            }

            $unitIds = array_map(static fn($u) => (int) $u['id'], $identity['units'] ?? []);
            if (!in_array((int) $unitId, $unitIds, true)) {
                return (new Response())->json(['status' => 'error', 'error' => 'Unidade nao autorizada.'], 403);
            }

            $allowed = $isAdmin
                ? ['rule', 'model', 'schema', 'permission']
                : ['rule', 'model', 'schema'];
            $namespaces = [];
            foreach ($requested as $name) {
                if (!is_string($name) || !in_array($name, $allowed, true)) {
                    return (new Response())->json(['status' => 'error', 'error' => 'Namespace nao autorizado.'], 403);
                }
                $namespaces[$name] = true;
            }

            $binds = [];
            foreach (array_keys($namespaces) as $i => $name) {
                $binds[':ns' . $i] = $name;
            }
            $inSql = implode(',', array_keys($binds));

            // Banco OPERACIONAL estritamente READ ONLY. O PossebonBrainService::context()
            // nao e usado porque sua ensureTables() executa DDL.
            TTransaction::open('possebon_app');
            $db = TTransaction::get();
            $db->exec('SET TRANSACTION READ ONLY');
            $db->exec("SET LOCAL statement_timeout = '3000ms'");

            $sql = "
WITH q AS (
  SELECT CAST(:text_fts AS text) AS text_fts,
         CAST(:text_exact AS text) AS text_exact
)
SELECT k.id, k.unit_id, k.namespace, k.title, k.content,
       k.source_type, k.source_ref, k.authority, k.source_updated_at
FROM possebon_ai_knowledge k CROSS JOIN q
WHERE k.status = 'ACTIVE'
  AND (k.unit_id IS NULL OR k.unit_id = :unit_id)
  AND k.namespace IN ({$inSql})
  AND (
    to_tsvector('simple', COALESCE(k.title,'') || ' ' || COALESCE(k.content,'')) @@ plainto_tsquery('simple', q.text_fts)
    OR lower(COALESCE(k.title,'')) LIKE '%' || lower(q.text_exact) || '%'
    OR lower(k.knowledge_key) LIKE '%' || lower(q.text_exact) || '%'
  )
ORDER BY
  CASE WHEN k.namespace = 'rule' AND k.authority >= 95 THEN 0 ELSE 1 END,
  k.authority DESC, k.source_updated_at DESC NULLS LAST, k.id DESC
LIMIT :query_limit
";
            $stmt = $db->prepare($sql);
            $stmt->bindValue(':text_fts', $question, PDO::PARAM_STR);
            $stmt->bindValue(':text_exact', $question, PDO::PARAM_STR);
            $stmt->bindValue(':unit_id', (int) $unitId, PDO::PARAM_INT);
            $stmt->bindValue(':query_limit', (int) $limit, PDO::PARAM_INT);
            foreach ($binds as $placeholder => $name) {
                $stmt->bindValue($placeholder, $name, PDO::PARAM_STR);
            }
            $stmt->execute();
            $items = [];
            $totalChars = 0;
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $content = (string) ($row['content'] ?? '');
                $available = max(0, 8000 - $totalChars);
                if ($available === 0) break;
                $content = mb_substr($content, 0, min(1200, $available));
                $totalChars += mb_strlen($content);
                $items[] = [
                    'id' => (string) $row['id'],
                    'unit_id' => $row['unit_id'] === null ? null : (int) $row['unit_id'],
                    'namespace' => (string) $row['namespace'],
                    'title' => mb_substr((string) ($row['title'] ?? ''), 0, 240),
                    'content' => $content,
                    'authority' => (int) $row['authority'],
                    'source_type' => (string) $row['source_type'],
                    'source_ref' => isset($row['source_ref']) ? (string) $row['source_ref'] : null,
                    'source_updated_at' => isset($row['source_updated_at'])
                        ? (string) $row['source_updated_at'] : null,
                ];
            }
            TTransaction::close();
            return (new Response())->json([
                'status' => 'success',
                'data' => ['unit_id' => (int) $unitId, 'items' => $items],
            ]);
        } catch (Throwable $e) {
            if (TTransaction::get()) TTransaction::rollback();
            error_log('ADA Brain readonly: ' . get_class($e) . ': ' . $e->getMessage());
            return (new Response())->json([
                'status' => 'error', 'error' => 'Consulta ao Brain indisponivel.',
            ], 503);
        }
    }
}
