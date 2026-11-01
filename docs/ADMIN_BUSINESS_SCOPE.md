# Consulta administrativa e contexto da unidade

Correção do bloqueio da procurement por ausência de vínculo de unidade.

O acesso administrativo é confirmado pela identidade POSSEBON, papel admin e programa AdaAdministracao, conforme a política operacional existente. Esse acesso permite buscar tabelas de negócio da conexão mesmo sem unit_id ou caminho único de FK. Acesso PostgreSQL e proteções de credenciais continuam aplicados.

A pergunta usa a unidade ativa por padrão: OperationalPlan.unitScope=current. Quando há vínculo de unidade verificável, o executor mantém esse filtro, inclusive nos JOINs. A opção all só pode ser usada por administrador, para pedidos entre unidades.

Se a tabela não tiver vínculo verificável, o administrador pode buscar os registros. O retorno informa scope=unit_unverified, unitId=null e requestedUnitId com a unidade pedida. A assistente deve verificar empresa, contrato ou projeto antes de afirmar que um registro pertence à EPC13. Encontrar um notebook não comprova sua unidade. O panorama inicial automático continua usando somente tabelas com unidade verificável.

Usuários comuns continuam com permissões por tabela/campo, unidade e vínculos de responsabilidade; não podem selecionar all nem escapar do filtro usando a declaração de consulta. Identidades de desenvolvimento não recebem acesso ao banco operacional.

Os testes usam dados controlados: procurement sem unidade, pedidos de unidades 3 e 4, JOIN real, busca administrativa, isolamento de usuário comum e rejeição de identidade sintética. A SC/OC real e a estrutura concreta da procurement no servidor ainda exigem validação após a implantação. Esta correção não comprova estudo integral do acervo nem conhecimento antecipado de todos os registros.
