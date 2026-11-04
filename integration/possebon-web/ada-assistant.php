<?php
/** Endpoint da conversa global. Usa a sessão existente do POSSEBON; não aceita identidade do navegador. */
chdir(__DIR__);
require_once 'init.php';
new TSession;
require_once 'app/custom/AdaIntegrationService.php';
require_once 'app/custom/AdaAssistantBridge.php';
AdaAssistantBridge::respond();
