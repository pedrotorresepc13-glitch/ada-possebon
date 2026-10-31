import { createHash } from 'node:crypto';
import { chunkText, scanForInjection } from '@ada/domain';
import type { Deps } from '../core.ts';

/**
 * Caderno PÚBLICO curado em 29/10/2026, por fonte.
 * Apenas resumos próprios de páginas consultadas. Nenhuma cópia integral ou
 * crawling indiscriminado; jamais confundir empresa, consórcio e Petrobras.
 * Alterações de pesquisa exigem revisão do arquivo no Git.
 */
export const PUBLIC_KNOWLEDGE_REVISION = 'possebon-public-v1-20261029';
export interface VerifiedPublicFact {
  title: string;
  url: string;
  domain: string;
  published?: string;
  observed: string;
  content: string;
}
export const VERIFIED_PUBLIC_FACTS: VerifiedPublicFact[] = [
  {
    title: 'POSSEBON Engenharia — origem, histórico e sede',
    url: 'https://possebon.com.br/empresa/',
    domain: 'institucional',
    observed: '2026-10-29',
    content: 'A Alfredo A. Possebon Filho & Cia Ltda, conhecida como POSSEBON Engenharia e Serviços, iniciou as atividades em 31/07/1981, originalmente em engenharia civil. Mantém sede administrativa em Curitiba (PR), bairro Cajuru, e unidade de produção em Araucária (PR). Segundo o site institucional, presta serviços à Petrobras e subsidiárias desde 1984. É uma empresa de engenharia, construção, montagem e manutenção industrial; não é sinônimo da Petrobras nem do Consórcio EPC13.'
  },
  {
    title: 'POSSEBON Engenharia — serviços e certificações',
    url: 'https://possebon.com.br/servicos/',
    domain: 'servicos',
    observed: '2026-10-29',
    content: 'A POSSEBON divulga atividades de engenharia civil, terraplenagem, fundações, estruturas de concreto, pavimentação e drenagem. Também fabrica e monta tubulações, estruturas metálicas, equipamentos, oleodutos, gasodutos e tanques; realiza montagem eletromecânica, instalações elétricas, instrumentação, automação, subestações, comissionamento, pré-operação, partida e manutenção industrial. Seu site declara um Sistema de Gestão Integrado com certificações ISO 9001:2015, ISO 14001:2015 e ISO 45001:2018. Verificar a validade atual dos certificados antes de usar como comprovação contratual.'
  },
  {
    title: 'POSSEBON Engenharia — gestão integrada e compromisso institucional',
    url: 'https://possebon.com.br/empresa/',
    domain: 'governanca',
    observed: '2026-10-29',
    content: 'Na política institucional publicada, a POSSEBON declara compromissos com satisfação de clientes, melhoria contínua, prevenção à poluição e desperdício, segurança e saúde ocupacional, participação de trabalhadores, conformidade legal, ética e responsabilidade social. A política divulgada indica revisão 06 de 03/11/2023. Trata-se de declaração institucional, não de auditoria independente.'
  },
  {
    title: 'POSSEBON Engenharia — código de ética e conduta',
    url: 'https://possebon.com.br/codigo-de-conduta/',
    domain: 'governanca',
    observed: '2026-10-29',
    content: 'O Código de Ética e Conduta público da POSSEBON descreve compromissos com conduta honesta, responsável, transparente e com direitos humanos. Contempla apuração de denúncias e proibição de retaliação, além de sanções proporcionais a irregularidades comprovadas. A página informa revisão 02 e vigência 2023–2025: solicitar versão vigente ao setor responsável antes de citar como norma interna atual.'
  },
  {
    title: 'Consórcio POSSEBON/UPE/CPL — EPC13: formação e contrato',
    url: 'https://possebon.com.br/petrobras-formaliza-contrato-com-o-consorcio-possebon-upe-cpl-epc-13-para-avanco-do-complexo-de-energias-boaventura/',
    domain: 'epc13',
    published: '2025-10-16',
    observed: '2026-10-29',
    content: 'O Consórcio POSSEBON/UPE/CPL – EPC-13 reúne Alfredo A. Possebon Filho & Cia Ltda, Universal Process Equipamentos Industriais (UPE) e CPL Construtora. A POSSEBON divulgou assinatura contratual com a Petrobras em 03/10/2025, para engenharia, fornecimento de equipamentos, montagem e operação assistida das unidades ETA (estação de tratamento de água) e ETDI (estação de tratamento de despejos industriais) no Complexo de Energias Boaventura, localizado em Itaboraí, RJ. EPC13 designa esse contrato/consórcio; não designa toda a POSSEBON, todo o complexo ou toda a Petrobras.'
  },
  {
    title: 'Complexo de Energias Boaventura — contexto da Petrobras',
    url: 'https://agencia.petrobras.com.br/w/negocio/complexo-de-energias-boaventura-da-petrobras-vai-ofertar-21-milhoes-de-m-de-gas-natural',
    domain: 'boaventura',
    published: '2024-09-13',
    observed: '2026-10-29',
    content: 'Segundo a Agência Petrobras, o Complexo de Energias Boaventura foi inaugurado em 13/09/2024 em Itaboraí, RJ. Integra o Projeto Integrado Rota 3 e abriga uma unidade de processamento de gás natural (UPGN); a Petrobras informou capacidade de processamento de até 21 milhões de m³ de gás natural por dia. Esses dados tratam do empreendimento geral da Petrobras, não especificamente das unidades ETA/ETDI contratadas ao Consórcio EPC13. Valores são os divulgados naquela data, não medições atuais.'
  },
  {
    title: 'POSSEBON Engenharia e Serviços — apresentação no LinkedIn',
    url: 'https://br.linkedin.com/company/possebonengenhariaeservicos',
    domain: 'redes-sociais',
    observed: '2026-10-29',
    content: 'A página pública da POSSEBON Engenharia e Serviços no LinkedIn informa atuação no setor de construção, sede em Curitiba, fundação em 1981 e especialização em construção civil, montagem e manutenção industrial, elétrica e instrumentação. É fonte de comunicação institucional; números de seguidores, empregados e publicações mudam e precisam de consulta recente, não devem ser memorizados como constantes.'
  },
  {
    title: 'Consórcio EPC13 — início da engenharia divulgado pela UPE',
    url: 'https://pt.linkedin.com/posts/upe-universal-process_foi-dada-a-largada-para-a-engenharia-do-cons%C3%B3rcio-activity-7406438116019879936-qHrr',
    domain: 'epc13',
    observed: '2026-10-29',
    content: 'Publicação no LinkedIn da UPE – Universal Process relata reunião de início (Kick Off Meeting, KOM) de Engenharia do Consórcio EPC13 em 11/12/2025, com equipes de Engenharia da UPE, Possebon, CPL e Petrobras. É relato institucional da parceira, não comprovação de cronograma ou avanço físico atual.'
  },
  {
    title: 'EPC13 — projeto ETA/ETDI no contexto das obras do Boaventura',
    url: 'https://petronoticias.com.br/veja-a-lista-das-empresas-que-farao-as-obras-de-unidades-de-refino-do-complexo-boaventira-com-previsao-de-gerar-15-mil-empregos/',
    domain: 'epc13',
    published: '2025-10-06',
    observed: '2026-10-29',
    content: 'Cobertura setorial de outubro de 2025 identifica o Consórcio Possebon/UPE/CPL como responsável pelo pacote ETA/ETDI entre os contratos do Complexo Boaventura. Outros pacotes, como hidrotratamento, unidades de hidrogênio e tubovias, foram atribuídos a outras empresas ou consórcios; não atribuir essas atividades ao EPC13 sem fonte específica. As estimativas de empregos e investimentos da reportagem dizem respeito ao conjunto de obras, não a contratos isolados.'
  }
];

const sha = (data: string) => createHash('sha256').update(data).digest('hex');

/** Atualização idempotente do pacote PÚBLICO no banco da ADA, sem consultas à rede. */
export async function syncPublicKnowledge(d: Deps): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const bootKey = 'ada.public.possebon.curated.v1';
  const source = await d.db.query<{ id: string }>(
    "SELECT id FROM ada.knowledge_source WHERE config->>'bootstrap_key'=$1 LIMIT 1",
    [bootKey]
  );
  let sourceId = source.rows[0]?.id;
  if (!sourceId) {
    const created = await d.db.query<{ id: string }>(
      `INSERT INTO ada.knowledge_source
       (kind,name,scope,domain,sensitivity,required_programs,config,created_by,status)
       VALUES ('manual','ADA — conhecimento público curado POSSEBON/EPC13','global','institucional',
         'publico',ARRAY[]::text[],$1::jsonb,0,'ativo') RETURNING id`,
      [JSON.stringify({ bootstrap_key: bootKey, revision: PUBLIC_KNOWLEDGE_REVISION, origin: 'pesquisa-publica-curada', automaticallyCrawled: false })]
    );
    sourceId = created.rows[0]!.id;
  }

  let inserted = 0, updated = 0, unchanged = 0;
  for (const fact of VERIFIED_PUBLIC_FACTS) {
    const content = [
      `Título: ${fact.title}`,
      `Fonte pública de referência: ${fact.url}`,
      `Data consultada: ${fact.observed}`,
      fact.published ? `Publicação informada: ${fact.published}` : '',
      'Tipo: RESUMO EDITORIAL CURADO. Não é transcrição completa nem dado operacional em tempo real.',
      '',
      fact.content
    ].filter(Boolean).join('\n');
    if (scanForInjection(content).suspicious) throw new Error('Fonte pública suspeita: ' + fact.title);
    const checksum = sha(content);
    const old = await d.db.query<{ id: string; checksum: string }>(
      'SELECT id,checksum FROM ada.knowledge_document WHERE source_id=$1 AND title=$2 LIMIT 1',
      [sourceId, fact.title]
    );
    if (old.rows[0]?.checksum === checksum) { unchanged++; continue; }
    await d.db.tx(async (q) => {
      let documentId: string;
      if (old.rows[0]) {
        documentId = old.rows[0].id;
        await q.query(
          `UPDATE ada.knowledge_document SET checksum=$2,version=version+1,
           raw_content=$3,size_bytes=$4,extracted_text=$5,original_name=$6,domain=$7,
           status='indexado',sensitivity='publico',required_programs=ARRAY[]::text[],
           observed_at=$8,reviewed_at=now(),updated_at=now() WHERE id=$1`,
          [documentId,checksum,Buffer.from(content,'utf8'),Buffer.byteLength(content),
            content,fact.url,fact.domain,new Date(fact.observed+'T12:00:00Z')]
        );
        await q.query('DELETE FROM ada.knowledge_chunk WHERE document_id=$1',[documentId]);
        updated++;
      } else {
        const created = await q.query<{ id: string }>(
          `INSERT INTO ada.knowledge_document
           (source_id,title,mime_type,original_name,size_bytes,checksum,status,scope,unit_id,domain,
            sensitivity,required_programs,raw_content,extracted_text,created_by,reviewed_at,observed_at)
           VALUES ($1,$2,'text/plain',$3,$4,$5,'indexado','global',NULL,$6,'publico',
             ARRAY[]::text[],$7,$8,0,now(),$9) RETURNING id`,
          [sourceId,fact.title,fact.url,Buffer.byteLength(content),checksum,fact.domain,
            Buffer.from(content,'utf8'),content,new Date(fact.observed+'T12:00:00Z')]
        );
        documentId = created.rows[0]!.id;
        inserted++;
      }
      for (const chunk of chunkText(content)) {
        await q.query(
          'INSERT INTO ada.knowledge_chunk(document_id,ordinal,content) VALUES($1,$2,$3)',
          [documentId,chunk.ordinal,chunk.content]
        );
      }
    });
  }
  await d.db.query(
    "UPDATE ada.knowledge_source SET status='ativo',last_sync_at=now(),updated_at=now() WHERE id=$1",
    [sourceId]
  );
  return { inserted, updated, unchanged };
}
