// Acesso ao Supabase. Só usa a chave PÚBLICA; as permissões e regras do
// banco decidem o que cada pessoa pode ler ou gravar.
import { CONFIG } from './config.js';

export const configurado = !CONFIG.SUPABASE_URL.startsWith('COLE') && !CONFIG.SUPABASE_KEY.startsWith('COLE');
let sb = null;

export function iniciar() {
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return sb;
}
export const cliente = () => sb;

// Relógio: usa a hora do SERVIDOR (apenas para exibição de cronômetros).
let deslocamentoMs = 0;
export async function sincronizarRelogio() {
  const t0 = Date.now();
  const { data, error } = await sb.rpc('hora_servidor');
  const t1 = Date.now();
  if (!error && data) deslocamentoMs = new Date(data).getTime() - (t0 + t1) / 2;
}
export const agora = () => Date.now() + deslocamentoMs;

async function ler(consulta) {
  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  return data;
}

// O servidor devolve no máximo 1000 linhas por consulta; busca em páginas.
async function todas(montar) {
  const saida = [];
  for (let i = 0; ; i += 1000) {
    const d = await ler(montar().range(i, i + 999));
    saida.push(...d);
    if (d.length < 1000) break;
  }
  return saida;
}

export const listarEventos = () => ler(sb.from('eventos').select('*').order('id', { ascending: false }));

export async function carregarEvento(id) {
  const [evento] = await ler(sb.from('eventos').select('*').eq('id', id));
  if (!evento) throw new Error('Evento não encontrado.');
  const sessoes = await ler(sb.from('sessoes').select('*').eq('evento_id', id).order('ordem'));
  const ids = sessoes.map((s) => s.id);
  const vazio = Promise.resolve([]);
  const [inscricoes, participantes, equipes, concorrentes, palpites, resultados, pontos] = await Promise.all([
    ler(sb.from('inscricoes_evento').select('*').eq('evento_id', id)),
    ler(sb.from('participantes').select('id,nome_exibicao')),
    ler(sb.from('equipes').select('id,nome')),
    ids.length ? ler(sb.from('sessao_concorrentes').select('*').in('sessao_id', ids)) : vazio,
    ids.length ? ler(sb.from('palpites').select('*').in('sessao_id', ids)) : vazio,
    ids.length ? ler(sb.from('resultados').select('*').in('sessao_id', ids)) : vazio,
    ler(sb.from('v_pontos_sessao').select('*').eq('evento_id', id)),
  ]);
  return { evento, sessoes, inscricoes, participantes, equipes, concorrentes, palpites, resultados, pontos };
}

export async function carregarClassificacao(temporada) {
  const [eventos, individual, equipes, pontosEvento, participantes, nomesEquipes] = await Promise.all([
    ler(sb.from('eventos').select('id,nome,temporada,encerrado_em,conta_para_geral').eq('temporada', temporada).order('id')),
    ler(sb.from('v_classificacao_individual').select('*').eq('temporada', temporada)),
    ler(sb.from('v_classificacao_equipes').select('*').eq('temporada', temporada)),
    ler(sb.from('v_pontos_evento').select('*').eq('temporada', temporada).eq('encerrado', true).eq('conta_para_geral', true)),
    ler(sb.from('participantes').select('id,nome_exibicao')),
    ler(sb.from('equipes').select('id,nome')),
  ]);
  return { eventos, individual, equipes, pontosEvento, participantes, nomesEquipes };
}

export function carregarRegistro(eventoId) {
  return todas(() => {
    const q = sb.from('registro').select('*');
    return (eventoId === null ? q.is('evento_id', null) : q.eq('evento_id', eventoId)).order('seq');
  });
}

export async function meuParticipante() {
  const { data, error } = await sb.rpc('meu_participante');
  if (error) return null;
  return data && data.length ? data[0] : null;
}

export async function entrar(email, senha) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) throw new Error('E-mail ou senha incorretos.');
}
export const sair = () => sb.auth.signOut();
export async function definirSenha(senha) {
  const { error } = await sb.auth.updateUser({ password: senha });
  if (error) throw new Error(error.message);
}

// Grava o palpite. Se já existe, atualiza só as 5 posições; se não, insere.
// (O banco valida prazo, janela, inscrição e lista de concorrentes.)
export async function salvarPalpite({ sessaoId, participanteId, ids, existenteId }) {
  const [p1, p2, p3, p4, p5] = ids;
  if (existenteId) {
    await ler(sb.from('palpites').update({ p1, p2, p3, p4, p5 }).eq('id', existenteId).select('id'));
  } else {
    await ler(sb.from('palpites').insert({ sessao_id: sessaoId, participante_id: participanteId, p1, p2, p3, p4, p5 }).select('id'));
  }
}
