<?php
/**
 * Controlador REST exclusivo da ADA.
 * Nao altera ApiAppController nem inclui traits de APP, HOLO ou Mail Import.
 * Requer rotas registradas em app/routes/api.php no MAD Builder.
 */
require_once 'app/custom/AdaIdentityApiTrait.php';
require_once 'app/custom/AdaBrainApiTrait.php';

final class AdaApiController
{
    use AdaIdentityApiTrait;
    use AdaBrainApiTrait;
}
