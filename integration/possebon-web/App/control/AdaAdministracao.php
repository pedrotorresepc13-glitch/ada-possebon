<?php
/**
 * Programa administrativo de autorização da ADA.
 * É uma permissão do MAD Builder, não uma tela de gestão do POSSEBON Web.
 * A interface administrativa permanece dentro do aplicativo ADA.
 */
class AdaAdministracao extends TPage
{
    public function __construct()
    {
        parent::__construct();
        $info = new TElement('div');
        $info->style = 'padding: 20px;';
        $info->add('A administração da ADA está disponível no aplicativo independente.');
        parent::add($info);
    }
}
