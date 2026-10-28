<?php
/**
 * PROPOSTA — NÃO APLICADA. Página do POSSEBON Web que incorpora a ADA.
 * Preferir criar a página pelo MAD Builder (programa "AdaEmbedView") e colar apenas o conteúdo de onShow.
 *
 * Fluxo: usuário já logado → servidor emite ticket (60 s, uso único) → formulário POST automático
 * para /ada/api/ada/session/exchange com target no iframe → ADA cria sessão própria (cookie HttpOnly)
 * e redireciona para /ada/. O ticket não aparece na URL, no histórico nem em logs de acesso.
 */
class AdaEmbedView extends TPage
{
    public function __construct()
    {
        parent::__construct();
        try {
            $ticket = AdaIntegrationService::issueTicketForCurrentSession();
            $ada = AdaIntegrationService::adaUrl(); // ex.: https://<dominio-possebon>/ada
            $action = htmlspecialchars($ada . '/api/ada/session/exchange', ENT_QUOTES);
            $t = htmlspecialchars($ticket, ENT_QUOTES);
            $html = <<<HTML
<div style="height: calc(100vh - 120px); min-height: 560px;">
  <iframe name="ada_frame" title="ADA POSSEBON" src="about:blank"
          style="width:100%;height:100%;border:0;border-radius:8px"
          allow="clipboard-write" referrerpolicy="same-origin"></iframe>
  <form id="ada_sso" method="post" action="{$action}" target="ada_frame" style="display:none">
    <input type="hidden" name="ticket" value="{$t}">
  </form>
  <script>document.getElementById('ada_sso').submit();</script>
</div>
HTML;
            parent::add($html);
        } catch (Exception $e) {
            new TMessage('error', 'A ADA não está disponível: ' . $e->getMessage());
        }
    }
}
