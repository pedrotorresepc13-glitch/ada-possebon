/** Conferência somente leitura das permissões exigidas pelas migrations aditivas 0006/0007. */
export async function checkMigrationAccess(client) {
  const r=await client.query(`SELECT
    has_schema_privilege(current_user,'ada','CREATE')
    AND has_schema_privilege(current_user,'ada_migrations','CREATE')
    AND has_table_privilege(current_user,'ada_migrations.applied','SELECT')
    AND has_table_privilege(current_user,'ada_migrations.applied','INSERT')
    AND has_table_privilege(current_user,'ada.conversation','REFERENCES')
    AND has_table_privilege(current_user,'ada.dashboard','REFERENCES')
    AND has_table_privilege(current_user,'ada.operational_board','REFERENCES')
    AND has_table_privilege(current_user,'ada.knowledge_document','REFERENCES')
    AND has_table_privilege(current_user,'ada.knowledge_chunk','REFERENCES') AS allowed`);
  if(r.rows[0]?.allowed!==true)throw new Error('A conexão existente não tem as permissões de migração. Serviços continuam ativos. Configure /etc/ada/migrate.env com a conexão do dono dos schemas; não altere ada.env nem conceda privilégios extras à aplicação.');
}
