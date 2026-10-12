// Telas. Cada função devolve um elemento do DOM. Nada aqui decide
// permissões: isso é responsabilidade do banco.
import { h, fmtBR, fmtCurto, fmtHora, tempoRestante, baixarArquivo } from './util.js';
import * as api from './api.js';
import {
  estadoSessao, ROTULO_ESTADO, eventoPadrao, POSICOES, RESULTADO_POS,
  acertos, pivotarPontos, resumoEvento, verificarCadeia,
} from './logica.js';

const collator = new Intl.Collator('pt-BR');
const ARQUIVO_SEGURO = /^[\w.\-]+$/;   // impede caminhos fora da pasta de imagens

// ---------- componentes comuns ----------
export const carregando = () => h('p', { class: 'aviso', role: 'status' }, 'Carregando…');

export function alerta(msg, tipo = 'erro') {
  return h('div', { class: `alerta alerta-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, msg);
}

function seletorEvento(eventos, atualId, aoMudar, extras = []) {
  const sel = h('select', { class: 'campo', 'aria-label': 'Selecionar evento' },
    extras.map((e) => h('option', { value: e.valor, selected: e.valor === String(atualId) }, e.rotulo)),
    eventos.map((e) => h('option', { value: String(e.id), selected: String(e.id) === String(atualId) },
      `${e.temporada} · ${e.nome}${e.conta_para_geral ? '' : ' (extra)'}${e.encerrado_em ? ' · encerrado' : ''}`)));
  sel.addEventListener('change', () => aoMudar(sel.value));
  return h('div', { class: 'seletor' }, h('label', {}, 'Evento'), sel);
}

function imagemEvento(arquivo, alt, classe) {
  if (!arquivo || !ARQUIVO_SEGURO.test(arquivo)) return null;
  return h('img', { src: `eventos/${arquivo}`, alt, class: classe, loading: 'lazy' });
}

function cabecalhoEvento(evento, estadoGeral) {
  return h('div', { class: 'evento-cab' },
    imagemEvento(evento.arquivo_logotipo, `Logotipo: ${evento.nome}`, 'evento-logo'),
    h('div', { class: 'evento-texto' },
      h('h2', {}, evento.nome),
      h('p', { class: 'mudo' }, [evento.local, `Temporada ${evento.temporada}`, evento.serie,
        evento.conta_para_geral ? null : 'Evento extra (não conta para a classificação geral)'].filter(Boolean).join(' · ')),
      estadoGeral),
    imagemEvento(evento.arquivo_circuito, `Traçado: ${evento.nome}`, 'evento-circuito'));
}

function chip(estado) {
  return h('span', { class: `chip chip-${estado}` }, ROTULO_ESTADO[estado]);
}

function contagem(ctx, sessao, aoZerar) {
  const span = h('span', { class: 'contagem', 'aria-live': 'off' });
  const atualizar = () => {
    const resta = new Date(sessao.fecha_em).getTime() - api.agora();
    span.textContent = `Fecha em ${tempoRestante(resta)}`;
    if (resta <= 0) { ctx.pararTimer(id); if (aoZerar) aoZerar(); }
  };
  const id = ctx.timer(atualizar, 1000);
  atualizar();
  return span;
}

function indices(dados) {
  return {
    nomes: new Map(dados.participantes.map((p) => [p.id, p.nome_exibicao])),
    equipes: new Map(dados.equipes.map((e) => [e.id, e.nome])),
    insc: new Map(dados.inscricoes.map((i) => [i.participante_id, i])),
    resultado: new Map(dados.resultados.map((r) => [r.sessao_id, r])),
    rotulo: new Map(dados.concorrentes.map((c) => [c.id, c.rotulo])),
    palpites: dados.palpites.reduce((m, p) => {
      if (!m.has(p.sessao_id)) m.set(p.sessao_id, new Map());
      m.get(p.sessao_id).set(p.participante_id, p);
      return m;
    }, new Map()),
  };
}

function sessaoInicial(dados, idx) {
  const agoraMs = api.agora();
  const i = dados.sessoes.findIndex((s) =>
    estadoSessao(dados.evento, dados.sessoes, s, idx.resultado.get(s.id), agoraMs) !== 'resultado');
  return i >= 0 ? i : Math.max(0, dados.sessoes.length - 1);
}

// ---------- CENTRAL DE PALPITES ----------
export async function telaCentral(ctx, params) {
  const eventos = await api.listarEventos();
  const raiz = h('section', { class: 'pagina' }, h('h1', {}, 'Central de Palpites'));
  if (!eventos.length) return raiz.append(h('p', { class: 'aviso' }, 'Nenhum evento cadastrado ainda.')), raiz;

  const id = params.id ? Number(params.id) : eventoPadrao(eventos).id;
  const dados = await api.carregarEvento(id);
  const idx = indices(dados);

  raiz.append(seletorEvento(eventos, id, (v) => ctx.navegar(`#/evento/${v}`)));
  raiz.append(cabecalhoEvento(dados.evento));

  if (!dados.sessoes.length) return raiz.append(h('p', { class: 'aviso' }, 'Este evento ainda não tem sessões cadastradas.')), raiz;

  const abas = h('div', { class: 'abas', role: 'tablist' });
  const painel = h('div', { class: 'painel' });
  raiz.append(abas, painel);

  const mostrar = (i) => {
    ctx.limparTimers();
    abas.replaceChildren(...dados.sessoes.map((s, k) =>
      h('button', { class: `aba${k === i ? ' ativa' : ''}`, role: 'tab', 'aria-selected': k === i, onclick: () => mostrar(k) }, s.nome)));
    painel.replaceChildren(painelSessao(ctx, dados, idx, dados.sessoes[i], () => mostrar(i)));
  };
  mostrar(sessaoInicial(dados, idx));

  const resumo = secaoResumo(dados, idx);
  if (resumo) raiz.append(resumo);
  raiz.append(h('p', { class: 'mudo nota' },
    'Palpites são públicos. Cada alteração fica registrada na ', h('a', { href: `#/auditoria/${id}` }, 'Auditoria'),
    ', com data e hora em Brasília.'));
  return raiz;
}

function painelSessao(ctx, dados, idx, sessao, aoZerar) {
  const res = idx.resultado.get(sessao.id);
  const est = estadoSessao(dados.evento, dados.sessoes, sessao, res, api.agora());
  const por = idx.palpites.get(sessao.id) || new Map();

  const info = h('div', { class: 'info-sessao' },
    chip(est),
    h('span', {}, `Fechamento: ${fmtCurto(sessao.fecha_em)} (Brasília)`),
    h('span', {}, `${sessao.pontos_por_acerto} pts por acerto`),
    sessao.categoria ? h('span', {}, `Categoria: ${sessao.categoria}`) : null,
    est === 'aberta' ? contagem(ctx, sessao, aoZerar) : null);

  const ids = new Set([...dados.inscricoes.map((i) => i.participante_id), ...por.keys()]);
  const linhas = [...ids].map((pid) => {
    const p = por.get(pid);
    return { pid, p, nome: idx.nomes.get(pid) || '?', acertos: acertos(p, res) };
  });
  linhas.sort((a, b) => res
    ? (b.acertos - a.acertos) || collator.compare(a.nome, b.nome)
    : collator.compare(a.nome, b.nome));

  const cab = ['Participante', 'Equipe', '1º', '2º', '3º', '4º', '5º', ...(res ? ['Acertos', 'Pontos'] : [])];
  const corpo = [];
  if (res) {
    corpo.push(h('tr', { class: 'oficial' },
      h('th', { scope: 'row' }, 'Resultado oficial'), h('td', {}, '—'),
      RESULTADO_POS.map((k) => h('td', {}, idx.rotulo.get(res[k]) || '?')), h('td', {}, ''), h('td', {}, '')));
  }
  for (const l of linhas) {
    const eqId = idx.insc.get(l.pid)?.equipe_id;
    corpo.push(h('tr', {},
      h('th', { scope: 'row' }, l.nome),
      h('td', { class: 'mudo' }, eqId ? idx.equipes.get(eqId) || '' : '—'),
      POSICOES.map((k, n) => {
        if (!l.p) return h('td', { class: 'vazio' }, '—');
        const acerto = res && l.p[k] === res[RESULTADO_POS[n]];
        return h('td', { class: acerto ? 'acerto' : null }, idx.rotulo.get(l.p[k]) || '?');
      }),
      res ? [h('td', {}, String(l.acertos)), h('td', { class: 'forte' }, String(l.acertos * sessao.pontos_por_acerto))] : null));
  }
  if (!linhas.length) corpo.push(h('tr', {}, h('td', { colspan: cab.length, class: 'vazio' }, 'Nenhum palpite registrado.')));

  return h('div', {}, info,
    h('div', { class: 'tabela-rolagem' },
      h('table', { class: 'tabela' }, h('thead', {}, h('tr', {}, cab.map((c) => h('th', { scope: 'col' }, c)))), h('tbody', {}, corpo))));
}

function secaoResumo(dados, idx) {
  const comRes = dados.sessoes.filter((s) => idx.resultado.has(s.id));
  if (!comRes.length || !dados.pontos.length) return null;
  const r = resumoEvento(dados.pontos);
  const tab = (titulo, linhas, nome, comSessoes) => h('div', { class: 'bloco' }, h('h3', {}, titulo),
    h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, nome),
        comSessoes ? comRes.map((s) => h('th', {}, s.nome)) : null, h('th', {}, 'Total'))),
      h('tbody', {}, linhas.map((l, i) => h('tr', {},
        h('td', {}, String(i + 1)),
        h('th', { scope: 'row' }, (comSessoes ? idx.nomes : idx.equipes).get(l.id) || '?'),
        comSessoes ? comRes.map((s) => h('td', {}, String(l.porSessao.get(s.id) ?? 0))) : null,
        h('td', { class: 'forte' }, String(l.total))))))));
  return h('div', { class: 'resumo' },
    h('h2', {}, 'Pontuação do evento'),
    h('p', { class: 'mudo' }, dados.evento.encerrado_em ? 'Evento encerrado: pontos já compõem as classificações.' : 'Parcial: o evento ainda não foi encerrado.'),
    tab('Individual', r.individual, 'Participante', true),
    tab('Equipes', r.equipes, 'Equipe', false));
}

// ---------- MEU PALPITE ----------
export async function telaMeuPalpite(ctx, params) {
  const raiz = h('section', { class: 'pagina' }, h('h1', {}, 'Meu Palpite'));
  const eu = ctx.estado.participante;
  if (!eu) {
    raiz.append(alerta('Esta conta não está vinculada a um participante. Fale com o ADM.'));
    return raiz;
  }
  raiz.append(h('p', { class: 'mudo' }, `Logado como ${eu.nome_exibicao}.`));
  const eventos = await api.listarEventos();
  if (!eventos.length) return raiz.append(h('p', { class: 'aviso' }, 'Nenhum evento cadastrado ainda.')), raiz;

  const id = params.id ? Number(params.id) : eventoPadrao(eventos).id;
  const dados = await api.carregarEvento(id);
  const idx = indices(dados);
  raiz.append(seletorEvento(eventos, id, (v) => ctx.navegar(`#/meu-palpite/${v}`)));
  raiz.append(cabecalhoEvento(dados.evento));

  if (!dados.sessoes.length) return raiz.append(h('p', { class: 'aviso' }, 'Este evento ainda não tem sessões.')), raiz;
  const inscrito = idx.insc.has(eu.id);
  if (!inscrito) {
    raiz.append(alerta('Você ainda não está inscrito neste evento. A inscrição é criada quando o ADM abre a janela de palpites.', 'info'));
  }
  ctx.limparTimers();
  for (const s of dados.sessoes) {
    raiz.append(cartaoSessao(ctx, dados, idx, s, eu, inscrito));
  }
  raiz.append(h('p', { class: 'mudo nota' }, 'O prazo é verificado pelo servidor no momento do envio. O contador abaixo é apenas informativo.'));
  return raiz;
}

function cartaoSessao(ctx, dados, idx, sessao, eu, inscrito) {
  const res = idx.resultado.get(sessao.id);
  const est = estadoSessao(dados.evento, dados.sessoes, sessao, res, api.agora());
  const meu = idx.palpites.get(sessao.id)?.get(eu.id);
  const concs = dados.concorrentes.filter((c) => c.sessao_id === sessao.id).sort((a, b) => collator.compare(a.rotulo, b.rotulo));

  const cartao = h('article', { class: 'cartao' },
    h('div', { class: 'cartao-topo' }, h('h3', {}, sessao.nome), chip(est)),
    h('p', { class: 'mudo' }, `Fechamento: ${fmtCurto(sessao.fecha_em)} (Brasília) · ${sessao.pontos_por_acerto} pts por acerto`
      + (sessao.categoria ? ` · ${sessao.categoria}` : '')));

  if (est === 'aberta' && inscrito) {
    cartao.append(contagem(ctx, sessao, ctx.recarregar), formularioPalpite(ctx, sessao, eu, meu, concs));
    return cartao;
  }
  if (meu) {
    cartao.append(h('ol', { class: 'lista-palpite' }, POSICOES.map((k, n) => {
      const acerto = res && meu[k] === res[RESULTADO_POS[n]];
      return h('li', { class: acerto ? 'acerto' : null }, idx.rotulo.get(meu[k]) || '?');
    })));
    if (res) cartao.append(h('p', { class: 'forte' }, `${acertos(meu, res)} acerto(s) · ${acertos(meu, res) * sessao.pontos_por_acerto} pts`));
  } else {
    cartao.append(h('p', { class: 'vazio' }, est === 'aberta' ? 'Sem palpite.' : 'Você não enviou palpite para esta sessão.'));
  }
  return cartao;
}

function formularioPalpite(ctx, sessao, eu, meu, concs) {
  const selects = POSICOES.map((k, n) => {
    const sel = h('select', { class: 'campo', id: `s${sessao.id}-p${n + 1}`, 'aria-label': `${n + 1}º lugar` },
      h('option', { value: '' }, 'Selecione…'),
      concs.map((c) => h('option', { value: String(c.id), selected: meu && meu[k] === c.id }, c.rotulo)));
    return sel;
  });
  const atualizarOpcoes = () => {
    const usados = new Set(selects.map((s) => s.value).filter(Boolean));
    for (const s of selects) for (const o of s.options) o.disabled = o.value !== '' && usados.has(o.value) && o.value !== s.value;
  };
  selects.forEach((s) => s.addEventListener('change', atualizarOpcoes));
  atualizarOpcoes();

  const msg = h('div', { class: 'msg-form', role: 'status' });
  const botao = h('button', { type: 'submit', class: 'botao botao-acao' }, meu ? 'Atualizar palpite' : 'Enviar palpite');
  const form = h('form', { class: 'form-palpite', novalidate: true },
    selects.map((s, n) => h('div', { class: 'linha-campo' }, h('label', { for: s.id }, `${n + 1}º`), s)),
    h('div', { class: 'acoes' }, botao), msg);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    const ids = selects.map((s) => Number(s.value));
    if (ids.some((v) => !v)) return msg.replaceChildren(alerta('Selecione os 5 concorrentes.'));
    if (new Set(ids).size < 5) return msg.replaceChildren(alerta('Há concorrentes repetidos.'));
    botao.disabled = true;
    try {
      await api.salvarPalpite({ sessaoId: sessao.id, participanteId: eu.id, ids, existenteId: meu?.id });
      ctx.toast(`Palpite de "${sessao.nome}" salvo às ${fmtHora(api.agora())} (horário de Brasília).`, 'ok');
      await ctx.recarregar();
    } catch (err) {
      msg.replaceChildren(alerta(err.message));
      botao.disabled = false;
    }
  });
  return form;
}

// ---------- CLASSIFICAÇÕES ----------
export async function telaClassificacao(ctx, params) {
  const raiz = h('section', { class: 'pagina' }, h('h1', {}, 'Classificações'));
  const eventos = await api.listarEventos();
  const temporadas = [...new Set(eventos.map((e) => e.temporada))].sort((a, b) => b - a);
  if (!temporadas.length) return raiz.append(h('p', { class: 'aviso' }, 'Nenhum evento cadastrado ainda.')), raiz;
  const temp = params.id ? Number(params.id) : temporadas[0];

  const sel = h('select', { class: 'campo', 'aria-label': 'Temporada' },
    temporadas.map((t) => h('option', { value: String(t), selected: t === temp }, String(t))));
  sel.addEventListener('change', () => ctx.navegar(`#/classificacao/${sel.value}`));
  raiz.append(h('div', { class: 'seletor' }, h('label', {}, 'Temporada'), sel));

  const d = await api.carregarClassificacao(temp);
  const cols = d.eventos.filter((e) => e.encerrado_em && e.conta_para_geral);
  if (!cols.length) return raiz.append(h('p', { class: 'aviso' }, 'Nenhuma etapa encerrada nesta temporada.')), raiz;

  const nomes = new Map(d.participantes.map((p) => [p.id, p.nome_exibicao]));
  const equipes = new Map(d.nomesEquipes.map((e) => [e.id, e.nome]));
  const bloco = (titulo, chave, mapa, rotuloCol) => {
    const m = pivotarPontos(d.pontosEvento, chave, cols.map((e) => e.id));
    return h('div', { class: 'bloco' }, h('h2', {}, titulo),
      h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, rotuloCol),
          cols.map((e) => h('th', { title: e.nome }, e.nome)), h('th', {}, 'Total'))),
        h('tbody', {}, m.linhas.map((l) => h('tr', {},
          h('td', {}, String(l.posicao)), h('th', { scope: 'row' }, mapa.get(l.id) || '?'),
          cols.map((e) => h('td', {}, l.porEvento.has(e.id) ? String(l.porEvento.get(e.id)) : '—')),
          h('td', { class: 'forte' }, String(l.total))))))));
  };
  raiz.append(bloco('Campeonato individual', 'participante_id', nomes, 'Participante'));
  raiz.append(bloco('Campeonato de equipes', 'equipe_id', equipes, 'Equipe'));
  raiz.append(h('p', { class: 'mudo nota' },
    'Somente etapas encerradas que contam para a classificação geral. Empates compartilham a posição; o desempate de fim de temporada será aplicado ao final do campeonato. ',
    'Os pontos de cada equipe permanecem nela, mesmo que um integrante troque de equipe.'));
  return raiz;
}

// ---------- AUDITORIA ----------
export async function telaAuditoria(ctx, params) {
  const raiz = h('section', { class: 'pagina' }, h('h1', {}, 'Auditoria'));
  const eventos = await api.listarEventos();
  const alvo = params.id === 'adm' ? 'adm' : params.id ? Number(params.id) : (eventos[0]?.id ?? 'adm');
  raiz.append(seletorEvento(eventos, alvo, (v) => ctx.navegar(`#/auditoria/${v}`),
    [{ valor: 'adm', rotulo: 'Registro administrativo (cadastros, equipes, filiações)' }]));
  raiz.append(h('p', { class: 'mudo' },
    'Cada evento tem seu próprio histórico, somente de inserção. Cada linha contém o código (hash) da anterior: alterar qualquer linha antiga invalida todas as seguintes. ',
    'Os horários são de Brasília, com precisão de segundos.'));

  const linhas = await api.carregarRegistro(alvo === 'adm' ? null : alvo);
  if (!linhas.length) return raiz.append(h('p', { class: 'aviso' }, 'Nenhum registro neste histórico.')), raiz;

  // verificação
  const resultado = h('div', { class: 'resultado-verif', role: 'status' });
  const btnVerif = h('button', { class: 'botao', type: 'button' }, 'Verificar integridade da cadeia');
  btnVerif.addEventListener('click', async () => {
    btnVerif.disabled = true;
    resultado.replaceChildren(h('p', {}, 'Recalculando…'));
    const v = await verificarCadeia(linhas);
    resultado.replaceChildren(v.ok
      ? alerta(`Cadeia íntegra: ${v.total} registros recalculados neste navegador. Hash final: ${v.ultimo}`, 'ok')
      : alerta(`FALHA na linha ${v.seq}. ${v.motivo}`));
    btnVerif.disabled = false;
  });
  const btnBaixar = h('button', { class: 'botao', type: 'button',
    onclick: () => baixarArquivo(`registro-${alvo}.json`, JSON.stringify(linhas, null, 2), 'application/json') }, 'Baixar registro (JSON)');
  raiz.append(h('div', { class: 'acoes' }, btnVerif, btnBaixar), resultado);
  raiz.append(h('p', { class: 'mudo nota' }, `Hash da última linha (guarde uma cópia fora do sistema para comparar depois): ${linhas.at(-1).hash}`));

  // filtros
  const tipos = [...new Set(linhas.map((l) => l.tipo))].sort();
  const busca = h('input', { class: 'campo', type: 'search', placeholder: 'Buscar no registro…', 'aria-label': 'Buscar no registro' });
  const filtroTipo = h('select', { class: 'campo', 'aria-label': 'Filtrar por tipo' },
    h('option', { value: '' }, 'Todos os tipos'), tipos.map((t) => h('option', { value: t }, t)));
  const lista = h('div', { class: 'tabela-rolagem' });
  const desenhar = () => {
    const q = busca.value.trim().toLowerCase();
    const sel = [...linhas].reverse().filter((l) => (!filtroTipo.value || l.tipo === filtroTipo.value)
      && (!q || `${l.autor} ${l.descricao} ${l.valor_anterior ?? ''} ${l.valor_novo ?? ''} ${l.motivo ?? ''}`.toLowerCase().includes(q)));
    lista.replaceChildren(h('table', { class: 'tabela tabela-log' },
      h('thead', {}, h('tr', {}, ['#', 'Data e hora (Brasília)', 'Quem', 'O que aconteceu', 'Motivo'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, sel.map((l) => h('tr', { class: l.autor.startsWith('ACESSO DIRETO') ? 'suspeito' : null },
        h('td', {}, String(l.seq)), h('td', { class: 'nowrap' }, fmtBR(l.ocorrido_em)), h('td', {}, l.autor),
        h('td', {}, h('div', {}, l.descricao),
          l.valor_anterior ? h('div', { class: 'mudo' }, `Antes: ${l.valor_anterior}`) : null,
          l.valor_novo ? h('div', { class: 'mudo' }, `Depois: ${l.valor_novo}`) : null),
        h('td', { class: 'mudo' }, l.motivo || '')))),
      sel.length ? null : h('caption', {}, 'Nenhum registro corresponde ao filtro.')));
  };
  busca.addEventListener('input', desenhar);
  filtroTipo.addEventListener('change', desenhar);
  raiz.append(h('div', { class: 'filtros' }, busca, filtroTipo), lista);
  desenhar();
  return raiz;
}

// ---------- ENTRAR / DEFINIR SENHA ----------
export function telaEntrar(ctx) {
  const msg = h('div', { role: 'alert' });
  const email = h('input', { class: 'campo', type: 'email', id: 'email', autocomplete: 'username', required: true });
  const senha = h('input', { class: 'campo', type: 'password', id: 'senha', autocomplete: 'current-password', required: true });
  const botao = h('button', { class: 'botao botao-primario', type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'form-simples', novalidate: true },
    h('div', { class: 'linha-campo' }, h('label', { for: 'email' }, 'E-mail'), email),
    h('div', { class: 'linha-campo' }, h('label', { for: 'senha' }, 'Senha'), senha),
    h('div', { class: 'acoes' }, botao), msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!email.value || !senha.value) return msg.replaceChildren(alerta('Informe e-mail e senha.'));
    botao.disabled = true;
    try { await api.entrar(email.value, senha.value); await ctx.atualizarSessao(); ctx.navegar('#/meu-palpite'); }
    catch (err) { msg.replaceChildren(alerta(err.message)); botao.disabled = false; }
  });
  return h('section', { class: 'pagina estreita' }, h('h1', {}, 'Entrar'),
    h('p', { class: 'mudo' }, 'O login é necessário apenas para enviar ou editar o seu palpite. A Central de Palpites é pública.'),
    form,
    h('p', { class: 'mudo nota' }, 'Esqueceu a senha? A redefinição é feita mediante solicitação ao ADM, pelo grupo.'));
}

export function telaDefinirSenha(ctx) {
  const msg = h('div', { role: 'alert' });
  const s1 = h('input', { class: 'campo', type: 'password', id: 'n1', autocomplete: 'new-password', required: true });
  const s2 = h('input', { class: 'campo', type: 'password', id: 'n2', autocomplete: 'new-password', required: true });
  const botao = h('button', { class: 'botao botao-acao', type: 'submit' }, 'Definir senha');
  const form = h('form', { class: 'form-simples', novalidate: true },
    h('div', { class: 'linha-campo' }, h('label', { for: 'n1' }, 'Nova senha (mínimo de 8 caracteres)'), s1),
    h('div', { class: 'linha-campo' }, h('label', { for: 'n2' }, 'Repita a senha'), s2),
    h('div', { class: 'acoes' }, botao), msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (s1.value.length < 8) return msg.replaceChildren(alerta('A senha deve ter ao menos 8 caracteres.'));
    if (s1.value !== s2.value) return msg.replaceChildren(alerta('As senhas não coincidem.'));
    botao.disabled = true;
    try { await api.definirSenha(s1.value); await ctx.atualizarSessao(); ctx.estado.definirSenha = false; ctx.toast('Senha definida com sucesso.', 'ok'); ctx.navegar('#/meu-palpite'); }
    catch (err) { msg.replaceChildren(alerta(err.message)); botao.disabled = false; }
  });
  return h('section', { class: 'pagina estreita' }, h('h1', {}, 'Definir senha'),
    h('p', { class: 'mudo' }, 'Escolha a sua senha. Ela é pessoal: nem o ADM a conhece.'), form);
}
