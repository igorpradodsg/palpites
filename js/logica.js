// Regras PURAS (sem acesso à página nem ao banco), espelhando as regras do
// banco apenas para EXIBIÇÃO. Quem decide de fato se um palpite é aceito é
// o banco de dados, a cada gravação, com o relógio do servidor.
import { sha256hex } from './util.js';

const t = (v) => new Date(v).getTime();

// Janela aberta = houve abertura pelo ADM POSTERIOR ao fechamento da última
// sessão do evento cujo horário já passou.
export function janelaAberta(evento, sessoes, agoraMs) {
  if (!evento.janela_aberta_em || evento.encerrado_em) return false;
  const passadas = sessoes.filter((s) => t(s.fecha_em) <= agoraMs).map((s) => t(s.fecha_em));
  if (passadas.length && t(evento.janela_aberta_em) <= Math.max(...passadas)) return false;
  return true;
}

// 'resultado' | 'encerrada' | 'fechada' | 'aberta' | 'aguardando'
export function estadoSessao(evento, sessoes, sessao, resultado, agoraMs) {
  if (resultado) return 'resultado';
  if (evento.encerrado_em) return 'encerrada';
  if (t(sessao.fecha_em) <= agoraMs) return 'fechada';
  return janelaAberta(evento, sessoes, agoraMs) ? 'aberta' : 'aguardando';
}

export const ROTULO_ESTADO = {
  resultado: 'Resultado registrado',
  encerrada: 'Encerrada',
  fechada: 'Fechada, aguardando resultado',
  aberta: 'Palpites abertos',
  aguardando: 'Aguardando abertura da janela',
};

// Evento exibido por padrão: o primeiro ainda não encerrado (o mais antigo
// em andamento); se todos estiverem encerrados, o mais recente.
export function eventoPadrao(eventos) {
  const abertos = eventos.filter((e) => !e.encerrado_em).sort((a, b) => a.id - b.id);
  return abertos[0] || [...eventos].sort((a, b) => b.id - a.id)[0];
}

export const POSICOES = ['p1', 'p2', 'p3', 'p4', 'p5'];
export const RESULTADO_POS = ['r1', 'r2', 'r3', 'r4', 'r5'];

export function acertos(palpite, resultado) {
  if (!palpite || !resultado) return 0;
  return POSICOES.reduce((n, p, i) => n + (palpite[p] === resultado[RESULTADO_POS[i]] ? 1 : 0), 0);
}

// Matriz participante/equipe x evento a partir de linhas de v_pontos_evento.
// chave = 'participante_id' ou 'equipe_id'. Retorna {linhas:[{id,total,porEvento:Map}], eventoIds}
export function pivotarPontos(linhas, chave, ordemEventos) {
  const por = new Map();
  for (const l of linhas) {
    const id = l[chave];
    if (id === null || id === undefined) continue;
    if (!por.has(id)) por.set(id, { id, total: 0, porEvento: new Map() });
    const r = por.get(id);
    r.porEvento.set(l.evento_id, (r.porEvento.get(l.evento_id) || 0) + l.pontos);
    r.total += l.pontos;
  }
  const lista = [...por.values()].sort((a, b) => b.total - a.total);
  let pos = 0, ant = null;
  lista.forEach((r, i) => { if (r.total !== ant) { pos = i + 1; ant = r.total; } r.posicao = pos; });
  return { linhas: lista, eventoIds: ordemEventos };
}

// Pontos por sessão -> total por participante e por equipe (página do evento).
export function resumoEvento(pontosSessao) {
  const ind = new Map(), eq = new Map();
  for (const p of pontosSessao) {
    if (!ind.has(p.participante_id)) ind.set(p.participante_id, { id: p.participante_id, total: 0, porSessao: new Map() });
    const i = ind.get(p.participante_id);
    i.porSessao.set(p.sessao_id, p.pontos); i.total += p.pontos;
    if (p.equipe_id != null) {
      if (!eq.has(p.equipe_id)) eq.set(p.equipe_id, { id: p.equipe_id, total: 0 });
      eq.get(p.equipe_id).total += p.pontos;
    }
  }
  const ord = (m) => [...m.values()].sort((a, b) => b.total - a.total);
  return { individual: ord(ind), equipes: ord(eq) };
}

// Recalcula a cadeia de hashes no navegador, de forma independente do banco.
// Texto canônico: campos separados pelo caractere de código 30; horário em
// UTC no formato AAAA-MM-DDTHH:MM:SS.mmmZ; campos vazios = texto vazio.
export async function verificarCadeia(linhas) {
  let anterior = '0'.repeat(64);
  let esperado = 1;
  for (const l of linhas) {
    if (Number(l.seq) !== esperado) return { ok: false, seq: l.seq, motivo: 'Numeração descontínua (linha ausente ou repetida).' };
    if (l.hash_anterior !== anterior) return { ok: false, seq: l.seq, motivo: 'Encadeamento quebrado: o hash anterior não confere.' };
    const texto = [
      l.hash_anterior, String(l.seq), new Date(l.ocorrido_em).toISOString(),
      l.autor, l.tipo, l.descricao, l.valor_anterior ?? '', l.valor_novo ?? '', l.motivo ?? '',
    ].join('\u001e');
    if ((await sha256hex(texto)) !== l.hash) return { ok: false, seq: l.seq, motivo: 'Conteúdo alterado: o hash recalculado difere do registrado.' };
    anterior = l.hash;
    esperado += 1;
  }
  return { ok: true, total: linhas.length, ultimo: anterior };
}
