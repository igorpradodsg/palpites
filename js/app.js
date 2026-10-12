// Ponto de entrada: rotas, sessão de login e estrutura da página.
import { h } from './util.js';
import * as api from './api.js';
import { carregando, alerta, telaCentral, telaMeuPalpite, telaClassificacao, telaAuditoria, telaEntrar, telaDefinirSenha } from './telas.js';

const raiz = document.getElementById('app');
const estado = { sessao: null, participante: null, definirSenha: false };
let timers = [];
let geracao = 0;   // descarta respostas de navegações antigas

const ctx = {
  estado,
  navegar(hash) { if (location.hash === hash) rotear(); else location.hash = hash; },
  recarregar: () => rotear(),
  // Lê a sessão atual e o participante logado (usado logo após entrar/sair).
  async atualizarSessao() {
    const { data } = await api.cliente().auth.getSession();
    estado.sessao = data.session;
    estado.participante = data.session ? await api.meuParticipante() : null;
  },
  timer(fn, ms) { const id = setInterval(fn, ms); timers.push(id); return id; },
  pararTimer(id) { clearInterval(id); timers = timers.filter((t) => t !== id); },
  limparTimers() { timers.forEach(clearInterval); timers = []; },
  toast(texto, tipo = 'ok') {
    const area = document.getElementById('toasts');
    const el = h('div', { class: `toast toast-${tipo}`, role: 'status' }, texto);
    area.append(el);
    setTimeout(() => el.remove(), 6000);
  },
};

const ROTAS = {
  '': (p) => telaCentral(ctx, p),
  evento: (p) => telaCentral(ctx, p),
  classificacao: (p) => telaClassificacao(ctx, p),
  auditoria: (p) => telaAuditoria(ctx, p),
  'meu-palpite': (p) => telaMeuPalpite(ctx, p),
  entrar: () => telaEntrar(ctx),
  'definir-senha': () => telaDefinirSenha(ctx),
};

function cabecalho(rota) {
  const link = (hash, texto, chave) =>
    h('a', { href: hash, class: `nav-link${rota === chave ? ' ativo' : ''}`, 'aria-current': rota === chave ? 'page' : null }, texto);
  const logado = !!estado.sessao;
  return h('header', { class: 'topo' },
    h('a', { href: '#/', class: 'marca', 'aria-label': 'Box, Box! — Central de Palpites' },
      h('img', { src: 'img/logo-pequeno.png', alt: 'Box, Box!', width: 130, height: 72 })),
    h('nav', { class: 'nav', 'aria-label': 'Principal' },
      link('#/', 'Central de Palpites', ''), link('#/classificacao', 'Classificações', 'classificacao'),
      link('#/auditoria', 'Auditoria', 'auditoria')),
    h('div', { class: 'conta' },
      logado
        ? [h('a', { href: '#/meu-palpite', class: `botao botao-primario${rota === 'meu-palpite' ? ' ativo' : ''}` }, 'Meu Palpite'),
           h('button', { class: 'botao botao-discreto', type: 'button', onclick: async () => { await api.sair(); await ctx.atualizarSessao(); ctx.navegar('#/'); } }, 'Sair')]
        : h('a', { href: '#/entrar', class: 'botao botao-primario' }, 'Entrar')));
}

async function rotear() {
  ctx.limparTimers();
  const minha = ++geracao;
  const [rota = '', id] = location.hash.replace(/^#\/?/, '').split('/');
  const tela = ROTAS[rota] || ROTAS[''];
  const principal = h('main', { id: 'conteudo' }, carregando());
  raiz.replaceChildren(cabecalho(rota in ROTAS ? rota : ''), principal,
    h('footer', { class: 'rodape' }, 'Box, Box! · Campeonato de Palpites · Horários de Brasília'));
  try {
    if ((rota === 'meu-palpite') && !estado.sessao) { ctx.navegar('#/entrar'); return; }
    const conteudo = await tela({ id });
    if (minha !== geracao) return;
    principal.replaceChildren(conteudo);
    window.scrollTo(0, 0);
  } catch (e) {
    if (minha !== geracao) return;
    principal.replaceChildren(h('section', { class: 'pagina' },
      alerta(`Não foi possível carregar: ${e.message}`),
      h('button', { class: 'botao', type: 'button', onclick: rotear }, 'Tentar novamente')));
  }
}

async function iniciar() {
  if (!api.configurado) {
    raiz.replaceChildren(h('main', { class: 'pagina' }, h('h1', {}, 'Configuração pendente'),
      alerta('Edite o arquivo js/config.js e informe a Project URL e a Publishable key do Supabase.', 'info')));
    return;
  }
  // Links de convite/redefinição chegam com "type=invite|recovery" no endereço.
  const tipo = new URLSearchParams(location.hash.slice(1)).get('type');
  estado.definirSenha = tipo === 'invite' || tipo === 'recovery';

  const sb = api.iniciar();
  const { data } = await sb.auth.getSession();
  estado.sessao = data.session;
  if (estado.sessao) estado.participante = await api.meuParticipante();
  await api.sincronizarRelogio();
  setInterval(() => api.sincronizarRelogio(), 5 * 60 * 1000);

  sb.auth.onAuthStateChange((evento, sessao) => {
    // Não chamar o Supabase diretamente aqui dentro (pode travar): adia a chamada.
    setTimeout(async () => {
      const mudou = (sessao?.user?.id || null) !== (estado.sessao?.user?.id || null);
      estado.sessao = sessao;
      if (evento === 'PASSWORD_RECOVERY') estado.definirSenha = true;
      if (mudou) {
        estado.participante = sessao ? await api.meuParticipante() : null;
        rotear();
      }
    }, 0);
  });

  if (estado.definirSenha && estado.sessao) location.hash = '#/definir-senha';
  window.addEventListener('hashchange', rotear);
  await rotear();
}

iniciar();
