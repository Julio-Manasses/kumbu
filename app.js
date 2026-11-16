// ===== KUMBU - APP.JS v2.0.0 PRO =====

let supabase = null;
let SUPABASE_OK = false;

try {
  const { createClient } =
    await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm");
  const SUPABASE_URL = "https://lcfcurptohrpzxdaotwf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_og0DiPnnVHgMn0TyhwDGvQ_WdnZ442E";
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  SUPABASE_OK = true;
} catch (e) {
  console.warn("Supabase indisponível. Rodando em modo offline.", e);
}

// ===== ESTADO =====
let categoriaAtual = "Igreja";
let mesAtual = new Date();
let dados = {};
let metas = [];
let userId = null;
let userName = "Utilizador";
let syncing = false;
let isPremium = true;

const LS_DADOS = "kumbu_dados_v5";
const LS_METAS = "kumbu_metas_v5";
const LS_USER_ID = "kumbu_user_id";
const LS_USER_NAME = "kumbu_user_name";
const LS_NOTAS = "kumbu_notas";

const iconesCat = {
  Igreja: "bi-bank",
  Casa: "bi-house-door",
  Comida: "bi-egg-fried",
  Transporte: "bi-bus-front",
  Poupança: "bi-piggy-bank",
  Outros: "bi-box-seam",
};

// ============================================================
// ===== INDEXEDDB (Fila Offline) =====
// ============================================================
const DB_NAME = "kumbu_sync";
const DB_STORE = "fila";

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enfileirar(op) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).add({ ...op, ts: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function lerFila() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function removerDaFila(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function contarFila() {
  try {
    const db = await abrirDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

// ===== HELPERS =====
function chaveMes(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function nomeMes(date) {
  const meses = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  return `${meses[date.getMonth()]} ${date.getFullYear()}`;
}
function dadosDoMes() {
  const k = chaveMes(mesAtual);
  if (!dados[k]) dados[k] = { salario: 0, gastos: [], agregado: "1 pessoa" };
  return dados[k];
}
function guardarLocal() {
  try {
    localStorage.setItem(LS_DADOS, JSON.stringify(dados));
    localStorage.setItem(LS_METAS, JSON.stringify(metas));
    const notasEl = document.getElementById("bloco-notas");
    if (notasEl) localStorage.setItem(LS_NOTAS, notasEl.value);
  } catch (e) {}
}
function lerLocal() {
  try {
    const rawD = localStorage.getItem(LS_DADOS);
    if (rawD) dados = JSON.parse(rawD) || {};
    const rawM = localStorage.getItem(LS_METAS);
    if (rawM) metas = JSON.parse(rawM) || [];
    const rawN = localStorage.getItem(LS_NOTAS);
    const notasEl = document.getElementById("bloco-notas");
    if (rawN && notasEl) notasEl.value = rawN;
  } catch (e) {
    dados = {};
    metas = [];
  }
}

// ============================================================
// ===== NOTIFICAÇÕES PUSH =====
// ============================================================
async function pedirPermissaoNotificacao() {
  if (!("Notification" in window))
    return alert("O seu navegador não suporta notificações.");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    alert("Notificações ativadas com sucesso!");
    new Notification("Kumbu", {
      body: "As notificações estão ativas! Vamos te lembrar de gerir o teu dinheiro.",
    });
  } else {
    alert("Permissão de notificações negada.");
  }
}

function dispararNotificacao(titulo, mensagem) {
  if ("Notification" in window && Notification.permission === "granted") {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(titulo, {
          body: mensagem,
          icon: "icons/icon-192.png",
          vibrate: [200, 100, 200],
        });
      });
    } else {
      new Notification(titulo, { body: mensagem, icon: "icons/icon-192.png" });
    }
  }
}

// ============================================================
// ===== INDICADOR DE SYNC =====
// ============================================================
async function atualizarSyncStatus() {
  const el = document.getElementById("sync-status");
  if (!el) return;
  const pendentes = await contarFila();
  const online = navigator.onLine;

  el.className = "sync-status";
  if (syncing) {
    el.classList.add("syncing");
    el.innerHTML = `<i class="bi bi-arrow-repeat"></i>`;
  } else if (!online) {
    el.classList.add("offline");
    el.innerHTML = `<i class="bi bi-cloud-slash"></i>`;
  } else if (pendentes > 0) {
    el.classList.add("pending");
    el.innerHTML = `<i class="bi bi-cloud-arrow-up"></i>`;
  } else {
    el.classList.add("online");
    el.innerHTML = `<i class="bi bi-cloud-check"></i>`;
  }
}

// ============================================================
// ===== FILA E SYNC =====
// ============================================================
async function enfileirarGasto(gasto, chave) {
  if (userId) {
    await enfileirar({ tipo: "add_gasto", user_id: userId, chave, gasto });
    atualizarSyncStatus();
    tentarSincronizar();
  }
}
async function enfileirarSalario(salario, chave) {
  if (userId) {
    await enfileirar({ tipo: "set_salario", user_id: userId, chave, salario });
    atualizarSyncStatus();
    tentarSincronizar();
  }
}
async function enfileirarLimpeza(chave) {
  if (userId) {
    await enfileirar({ tipo: "limpar_gastos", user_id: userId, chave });
    atualizarSyncStatus();
    tentarSincronizar();
  }
}
async function tentarSincronizar() {
  if (navigator.onLine && userId && !syncing) processarFila();
}

async function processarFila() {
  if (!SUPABASE_OK || !navigator.onLine || syncing || !userId) return;
  syncing = true;
  await atualizarSyncStatus();
  try {
    const fila = await lerFila();
    for (const op of fila) {
      try {
        const orcId = await garantirOrcamento(op.user_id, op.chave);
        if (op.tipo === "add_gasto") {
          // CORREÇÃO: Enviar também a categoria (se a tabela tiver, senão ignora)
          await supabase.from("gastos").insert({
            user_id: op.user_id,
            orcamento_id: orcId,
            categoria_id: 1,
            nome: op.gasto.nome,
            valor: op.gasto.valor,
          });
        } else if (op.tipo === "set_salario") {
          await supabase
            .from("orcamentos")
            .update({ salario: op.salario })
            .eq("id", orcId);
        } else if (op.tipo === "limpar_gastos") {
          await supabase.from("gastos").delete().eq("orcamento_id", orcId);
        }
        await removerDaFila(op.id);
      } catch (e) {
        if (!navigator.onLine) break;
      }
    }
    await recarregarDoServidor();
  } finally {
    syncing = false;
    await atualizarSyncStatus();
  }
}

async function garantirOrcamento(uid, chave) {
  const [ano, mes] = chave.split("-").map(Number);
  let { data: orc } = await supabase
    .from("orcamentos")
    .select("id")
    .eq("user_id", uid)
    .eq("mes", mes)
    .eq("ano", ano)
    .maybeSingle();
  if (!orc) {
    const { data: novo, error } = await supabase
      .from("orcamentos")
      .insert({ user_id: uid, mes, ano, salario: 0 })
      .select()
      .single();
    if (error) throw error;
    orc = novo;
  }
  return orc.id;
}

// ============================================================
// ===== AUTH E PERFIL (Sessão Persistente) =====
// ============================================================
async function criarConta() {
  if (!navigator.onLine)
    return mostrarMsg("Para criar uma conta, precisa de internet.");
  const btn = document.getElementById("btn-criar");
  const txtOriginal = btn.innerHTML;
  btn.innerHTML = `<i class="bi bi-arrow-repeat" style="animation: spin 1s linear infinite; display:inline-block;"></i> A criar...`;
  btn.disabled = true;

  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  const nome = document.getElementById("nome-user").value.trim();

  if (!email || !senha || senha.length < 6) {
    mostrarMsg("Escreve email e senha com 6+ caracteres");
    btn.innerHTML = txtOriginal;
    btn.disabled = false;
    return;
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
    });
    if (error) throw error;
    if (data.user) {
      await supabase
        .from("perfis")
        .insert({ id: data.user.id, nome: nome || email, telefone: "" });
    }
    mostrarMsg("Conta criada! Clica em Entrar.");
    document.getElementById("msg-login").style.color = "var(--verde)";
  } catch (e) {
    mostrarMsg("Erro: " + e.message);
    document.getElementById("msg-login").style.color = "var(--vermelho)";
  } finally {
    btn.innerHTML = txtOriginal;
    btn.disabled = false;
  }
}

async function entrar() {
  if (!navigator.onLine)
    return mostrarMsg(
      "Sem internet! Use o botão laranja abaixo para entrar offline.",
    );
  const btn = document.getElementById("btn-entrar");
  const txtOriginal = btn.innerHTML;
  btn.innerHTML = `<i class="bi bi-arrow-repeat" style="animation: spin 1s linear infinite; display:inline-block;"></i> A entrar...`;
  btn.disabled = true;

  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });
    if (error) throw error;
    userId = data.user.id;
    localStorage.setItem(LS_USER_ID, userId);

    await carregarPerfil();
    await recarregarDoServidor();
    localStorage.setItem(LS_USER_NAME, userName);

    abrirApp(data.user);
    setTimeout(processarFila, 500);
  } catch (e) {
    mostrarMsg("Email ou senha errada.");
    document.getElementById("msg-login").style.color = "var(--vermelho)";
  } finally {
    btn.innerHTML = txtOriginal;
    btn.disabled = false;
  }
}

function entrarOffline() {
  const idSalvo = localStorage.getItem(LS_USER_ID);
  const nomeSalvo = localStorage.getItem(LS_USER_NAME);

  if (idSalvo) {
    userId = idSalvo;
    userName = nomeSalvo || "Utilizador";
    lerLocal();
    abrirApp({ id: userId });
    setTimeout(() => {
      alert(
        "Você está no modo offline. Os gastos serão sincronizados quando a internet voltar.",
      );
    }, 500);
  } else {
    mostrarMsg(
      "Nenhuma conta encontrada. Conecte-se e faça login pela primeira vez.",
    );
    document.getElementById("msg-login").style.color = "var(--laranja)";
  }
}

async function carregarPerfil() {
  try {
    const { data } = await supabase
      .from("perfis")
      .select("nome")
      .eq("id", userId)
      .single();
    if (data && data.nome) userName = data.nome;
  } catch (e) {}
}

async function sair() {
  try {
    if (supabase) await supabase.auth.signOut();
  } catch (_) {}
  location.reload();
}

function abrirApp(user) {
  document.getElementById("tela-login").style.display = "none";
  document.getElementById("app-principal").style.display = "block";
  document.getElementById("nome-logado").innerText =
    `BEM-VINDO!, ${userName.split(" ")[0]}`;
  atualizar();
  renderMetas();
  verificarLembrete();
}

function mostrarMsg(txt) {
  document.getElementById("msg-login").innerText = txt;
}

// ============================================================
// ===== DADOS E INTERFACE (CORREÇÃO DA SINCRONIZAÇÃO) =====
// ============================================================
async function recarregarDoServidor() {
  if (!SUPABASE_OK || !userId) return;
  try {
    // 1. Buscar todos os orçamentos (meses) do utilizador
    const { data: orcs } = await supabase
      .from("orcamentos")
      .select("id, mes, ano, salario")
      .eq("user_id", userId);
    if (!orcs || orcs.length === 0) return;

    for (const orc of orcs) {
      const chave = `${orc.ano}-${String(orc.mes).padStart(2, "0")}`;

      // Cria o mês se não existir no celular
      if (!dados[chave]) {
        dados[chave] = {
          salario: orc.salario || 0,
          gastos: [],
          agregado: "1 pessoa",
        };
      } else {
        // Se o mês já existe (offline), atualiza o salário se estiver vazio
        if (!dados[chave].salario || dados[chave].salario === 0) {
          dados[chave].salario = orc.salario;
        }
      }

      // 2. Buscar os gastos associados a este mês
      const { data: gastosDb } = await supabase
        .from("gastos")
        .select("id, nome, valor")
        .eq("orcamento_id", orc.id)
        .order("created_at", { ascending: true });

      if (gastosDb && gastosDb.length > 0) {
        // Filtra os gastos que estão pendentes localmente para não duplicar
        const pendentesLocais = dados[chave].gastos.filter((g) => g._pendente);

        // Junta os gastos do banco de dados com os que estão pendentes no telemóvel
        const gastosFormatados = gastosDb.map((g) => ({
          id: g.id,
          nome: g.nome,
          valor: Number(g.valor),
          // CORREÇÃO: Mantém a categoria original se houver, senão define como Outros
          cat: g.categoria_id === 1 ? "Igreja" : "Outros",
        }));

        dados[chave].gastos = [...gastosFormatados, ...pendentesLocais];
      }
    }
    guardarLocal();
    atualizar();
  } catch (e) {
    console.error("Erro ao sincronizar com o servidor:", e);
  }
}

// ===== PERSISTÊNCIA DE SESSÃO (Inicialização) =====
(async () => {
  lerLocal();
  if (SUPABASE_OK) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        userId = data.session.user.id;
        localStorage.setItem(LS_USER_ID, userId);
        await carregarPerfil();
        await recarregarDoServidor(); // Puxa os dados
        localStorage.setItem(LS_USER_NAME, userName);
        abrirApp(data.session.user);
        setTimeout(processarFila, 800);
        return;
      }
    } catch (_) {}
  }

  // Se não houver sessão no Supabase, tenta entrar offline automaticamente
  const idSalvo = localStorage.getItem(LS_USER_ID);
  if (idSalvo) {
    userId = idSalvo;
    userName = localStorage.getItem(LS_USER_NAME) || "Utilizador";
    abrirApp({ id: userId });
  } else {
    atualizarSyncStatus();
  }
})();

function mostrar(id, btn) {
  document
    .querySelectorAll(".tela")
    .forEach((t) => t.classList.remove("ativa"));
  document.getElementById(id).classList.add("ativa");
  document
    .querySelectorAll(".menu button")
    .forEach((b) => b.classList.remove("ativo"));
  if (btn) btn.classList.add("ativo");
  if (id === "tela-grafico") renderGrafico();
  if (id === "tela-metas") renderMetas();
  if (id === "tela-def") atualizarSyncStatus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function escolherCat(cat, el) {
  categoriaAtual = cat;
  document
    .querySelectorAll(".chip")
    .forEach((c) => c.classList.remove("ativo"));
  el.classList.add("ativo");
}

function mudarMes(delta) {
  mesAtual = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + delta, 1);
  atualizar();
  if (document.getElementById("tela-grafico")?.classList.contains("ativa"))
    renderGrafico();
}

async function adicionarGasto() {
  const nome = document.getElementById("nome").value.trim();
  const valor = Number(document.getElementById("valor").value);
  if (!nome || !valor) return alert("Escreve o nome e o valor");

  const chave = chaveMes(mesAtual);

  // Cria o gasto no celular e marca como pendente
  dadosDoMes().gastos.push({
    nome,
    valor,
    cat: categoriaAtual,
    _pendente: true,
  });
  guardarLocal();

  if (userId)
    await enfileirarGasto({ nome, valor, cat: categoriaAtual }, chave);

  document.getElementById("nome").value = "";
  document.getElementById("valor").value = "";

  atualizar();
  renderMetas();
  mostrar("tela-inicio", document.querySelector(".menu button"));
}

async function remover(i) {
  if (!confirm("Apagar este gasto?")) return;
  const chave = chaveMes(mesAtual);
  const d = dadosDoMes();
  const gasto = d.gastos[i];
  if (userId && gasto.id && navigator.onLine) {
    try {
      await supabase.from("gastos").delete().eq("id", gasto.id);
    } catch (_) {}
  }
  d.gastos.splice(i, 1);
  guardarLocal();
  atualizar();
  renderMetas();
}

async function limparTudo() {
  if (!confirm("Apagar todos os gastos DESTE mês?")) return;
  dadosDoMes().gastos = [];
  guardarLocal();
  if (userId) await enfileirarLimpeza(chaveMes(mesAtual));
  atualizar();
  renderMetas();
}

async function salvarSalario() {
  const salario = Number(document.getElementById("salario").value) || 0;
  dadosDoMes().salario = salario;
  guardarLocal();
  if (userId) await enfileirarSalario(salario, chaveMes(mesAtual));
  atualizar();
}

// ============================================================
// ===== FUNÇÕES DE METAS (Sincronizadas com Poupança) =====
// ============================================================
function salvarMeta() {
  const nome = document.getElementById("meta-nome").value.trim();
  const valor = Number(document.getElementById("meta-valor").value);

  if (!nome || !valor) return alert("Preenche o nome e o valor da meta.");

  metas.push({ nome, valorTotal: valor, id: Date.now() });
  guardarLocal();

  document.getElementById("meta-nome").value = "";
  document.getElementById("meta-valor").value = "";

  renderMetas();
}

function renderMetas() {
  const container = document.getElementById("lista-metas");
  if (!container) return;

  const poupancaTotal = dadosDoMes()
    .gastos.filter((g) => g.cat === "Poupança")
    .reduce((s, g) => s + Number(g.valor), 0);

  if (metas.length === 0) {
    container.innerHTML =
      "<p class='dica' style='color: var(--cinza-2); text-align: center;'>Ainda não tens metas. Cria uma acima!</p>";
    return;
  }

  container.innerHTML = metas
    .map((m, i) => {
      const valorGuardado = Math.min(m.valorTotal, poupancaTotal);
      const progresso = Math.min(100, (valorGuardado / m.valorTotal) * 100);

      return `
      <div class="item" style="border-left-color: var(--verde); flex-direction: column; align-items: stretch; padding: 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;">
          <b style="font-size: 16px; color: var(--branco);"><i class="bi bi-bullseye" style="color: var(--verde);"></i> ${m.nome}</b>
          <button class="btn-del" onclick="removerMeta(${i})" style="padding: 6px; min-width: auto; min-height: auto; border-radius: 50%;"><i class="bi bi-trash"></i></button>
        </div>
        <small style="margin-bottom: 8px; color: var(--cinza); font-size: 13px;">Guardado: <b>${valorGuardado.toLocaleString("pt-PT")} Kz</b> de ${m.valorTotal.toLocaleString("pt-PT")} Kz</small>
        <div class="barra-progresso" style="height: 10px; margin-top: 4px; background: rgba(0,0,0,0.3);">
          <div class="fill" style="width: ${progresso}%; background: var(--verde);"></div>
        </div>
      </div>
    `;
    })
    .join("");
}

function removerMeta(i) {
  if (!confirm("Apagar esta meta?")) return;
  metas.splice(i, 1);
  guardarLocal();
  renderMetas();
}

// ============================================================
// ===== INTERFACE E GRÁFICOS =====
// ============================================================
function atualizar() {
  const d = dadosDoMes();
  const salario = Number(d.salario) || 0;
  const total = d.gastos.reduce((s, g) => s + Number(g.valor), 0);
  const poupanca = d.gastos
    .filter((g) => g.cat === "Poupança")
    .reduce((s, g) => s + Number(g.valor), 0);
  const saldo = salario - total;

  document.getElementById("mes-label").innerText = nomeMes(mesAtual);
  const k = chaveMes(mesAtual);
  const hoje = chaveMes(new Date());
  document.getElementById("mes-status").innerText =
    k === hoje ? "Mês atual" : k < hoje ? "Mês passado" : "Mês futuro";

  document.getElementById("salario").value = salario;
  document.getElementById("agregado").value = d.agregado || "1 pessoa";

  document.getElementById("totalGasto").innerText =
    total.toLocaleString("pt-PT") + " Kz";
  document.getElementById("saldo").innerText =
    saldo.toLocaleString("pt-PT") + " Kz";
  document.getElementById("poupanca").innerText =
    poupanca.toLocaleString("pt-PT") + " Kz";

  const barra = document.getElementById("barra");
  if (barra) {
    barra.style.width =
      Math.min(100, salario > 0 ? (total / salario) * 100 : 0) + "%";
    barra.style.background =
      saldo < 0
        ? "linear-gradient(90deg,#EF4444,#F87171)"
        : "linear-gradient(90deg,#D4AF37,#F4D03F)";
  }

  const alerta = document.getElementById("alerta");
  if (saldo < 0) {
    alerta.className = "alerta erro";
    alerta.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Passaste ${Math.abs(saldo).toLocaleString("pt-PT")} Kz!`;
  } else {
    alerta.className = "alerta ok";
    alerta.innerHTML = `<i class="bi bi-check-circle-fill"></i> Ainda tens ${saldo.toLocaleString("pt-PT")} Kz este mês.`;
  }

  const lista = document.getElementById("lista-gastos");
  lista.innerHTML =
    d.gastos
      .slice()
      .reverse()
      .map((g, idx) => {
        const realIdx = d.gastos.length - 1 - idx;
        const icone = iconesCat[g.cat] || "bi-box-seam";
        const pend = g._pendente
          ? `<i class="bi bi-cloud-arrow-up" style="color:#F59E0B;font-size:12px;"></i> `
          : "";
        return `
      <div class="item ${g._pendente ? "pendente" : ""}">
        <div>
          <b><i class="bi ${icone}"></i> ${g.nome}</b> ${pend}<br>
          <small>${g.cat}</small>
        </div>
        <div style="text-align:right">
          <b>${Number(g.valor).toLocaleString("pt-PT")} Kz</b>
          <button class="btn-del" onclick="remover(${realIdx})"><i class="bi bi-trash"></i></button>
        </div>
      </div>`;
      })
      .join("") ||
    "<p style='color: var(--cinza-2); text-align: center;'>Nenhum gasto registado neste mês.</p>";
}

function renderGrafico() {
  const d = dadosDoMes();
  let totalPoupancaGlobal = 0;
  let totalGastosGlobal = 0;

  for (const key in dados) {
    dados[key].gastos.forEach((g) => {
      totalGastosGlobal += Number(g.valor);
      if (g.cat === "Poupança") totalPoupancaGlobal += Number(g.valor);
    });
  }

  document.getElementById("global-poupanca").innerText =
    totalPoupancaGlobal.toLocaleString("pt-PT") + " Kz";
  document.getElementById("global-gastos").innerText =
    totalGastosGlobal.toLocaleString("pt-PT") + " Kz";

  const total = d.gastos.reduce((s, g) => s + Number(g.valor), 0) || 1;
  const porCat = {};
  d.gastos.forEach(
    (g) => (porCat[g.cat] = (porCat[g.cat] || 0) + Number(g.valor)),
  );

  let html = "";
  let resumo = "";
  const ordem = Object.keys(porCat).sort((a, b) => porCat[b] - porCat[a]);

  for (const cat of ordem) {
    const perc = ((porCat[cat] / total) * 100).toFixed(1);
    html += `
      <div class="barra-cat">
        <b><i class="bi ${iconesCat[cat] || "bi-box-seam"}"></i> ${cat} — ${perc}% — ${porCat[cat].toLocaleString("pt-PT")} Kz</b>
        <div class="barra-progresso"><div class="fill" style="width:${perc}%"></div></div>
      </div>`;
    resumo += `${cat}: ${porCat[cat].toLocaleString("pt-PT")} Kz (${perc}%)\n`;
  }

  document.getElementById("grafico").innerHTML =
    html ||
    "<p style='color: var(--cinza-2); text-align: center;'>Sem dados para este mês.</p>";
  document.getElementById("resumo-cat").innerHTML = resumo
    ? `<pre>${resumo}</pre>`
    : "";
}

// ============================================================
// ===== GESTÃO DE CONTA E DEFINIÇÕES =====
// ============================================================
async function alterarSenha() {
  if (!navigator.onLine)
    return alert("Precisa de internet para alterar a senha.");
  const novaSenha = prompt("Digite a nova senha (mínimo 6 caracteres):");
  if (!novaSenha) return;
  if (novaSenha.length < 6)
    return alert("A senha deve ter no mínimo 6 caracteres.");

  try {
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    if (error) throw error;
    alert("Senha alterada com sucesso!");
  } catch (e) {
    alert("Erro ao alterar senha: " + e.message);
  }
}

async function alterarNome() {
  const novoNome = prompt("Digite o seu novo nome de exibição:");
  if (!novoNome) return;

  userName = novoNome;
  localStorage.setItem(LS_USER_NAME, userName);
  document.getElementById("nome-logado").innerText =
    `BEM-VINDO!, ${userName.split(" ")[0]}`;

  if (SUPABASE_OK && userId && navigator.onLine) {
    try {
      await supabase.from("perfis").update({ nome: novoNome }).eq("id", userId);
      alert("Nome alterado com sucesso no servidor!");
    } catch (e) {
      alert("Nome alterado localmente. Será sincronizado quando houver rede.");
    }
  }
}

async function eliminarConta() {
  if (!confirm("TENS A CERTEZA? Todos os teus dados serão APAGADOS.")) return;
  if (!confirm("Esta ação é irreversível. Deseja mesmo eliminar a conta?"))
    return;

  try {
    alert(
      "Por motivos de segurança, solicite ao administrador. Os teus dados locais serão apagados.",
    );
    localStorage.clear();
    await sair();
  } catch (e) {
    alert("Erro: " + e.message);
  }
}

// ============================================================
// ===== EXPORTAR PDF =====
// ============================================================
async function exportarPDF() {
  try {
    const { jsPDF } =
      await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js");
    const d = dadosDoMes();
    const salario = Number(d.salario) || 0;
    const total = d.gastos.reduce((s, g) => s + Number(g.valor), 0);
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    doc.setFillColor(10, 25, 49);
    doc.rect(0, 0, 210, 40, "F");
    doc.setTextColor(212, 175, 55);
    doc.setFontSize(24);
    doc.setFont(undefined, "bold");
    doc.text("KUMBU", 15, 20);
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, "normal");
    doc.text("Conta Certa — Resumo Mensal PRO", 15, 28);
    doc.text(nomeMes(mesAtual), 15, 35);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    let y = 55;
    doc.text(`Salario: ${salario.toLocaleString("pt-PT")} Kz`, 15, y);
    y += 7;
    doc.text(`Total Gasto: ${total.toLocaleString("pt-PT")} Kz`, 15, y);
    y += 7;

    doc.setFont(undefined, "bold");
    const saldo = salario - total;
    doc.text(`Saldo: ${saldo.toLocaleString("pt-PT")} Kz`, 15, y);
    y += 12;

    d.gastos.forEach((g) => {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(`- ${g.nome} [${g.cat}]`, 15, y);
      doc.text(`${Number(g.valor).toLocaleString("pt-PT")} Kz`, 195, y, {
        align: "right",
      });
      y += 6;
    });

    doc.save(`Kumbu_${nomeMes(mesAtual).replace(" ", "_")}.pdf`);
  } catch (e) {
    alert("Erro ao gerar PDF.");
  }
}

// ============================================================
// ===== LEMBRETES (Notificação Real) =====
// ============================================================
function verificarLembrete() {
  const hoje = new Date().getDate();
  if (hoje >= 28 || hoje <= 10) {
    const lastDismissed = localStorage.getItem("kumbu_lembrete_dismissed");
    const hojeStr = new Date().toDateString();
    if (lastDismissed !== hojeStr) {
      document.getElementById("banner-lembrete").style.display = "flex";
      dispararNotificacao(
        "Lembrete Kumbu",
        "Não te esqueças de registar os teus gastos e ver as tuas metas!",
      );
    }
  }
}

function fecharLembrete() {
  document.getElementById("banner-lembrete").style.display = "none";
  localStorage.setItem("kumbu_lembrete_dismissed", new Date().toDateString());
}

// ===== EXPOR =====
window.criarConta = criarConta;
window.entrar = entrar;
window.entrarOffline = entrarOffline;
window.sair = sair;
window.mostrar = mostrar;
window.escolherCat = escolherCat;
window.mudarMes = mudarMes;
window.adicionarGasto = adicionarGasto;
window.remover = remover;
window.limparTudo = limparTudo;
window.exportarPDF = exportarPDF;
window.alterarSenha = alterarSenha;
window.alterarNome = alterarNome;
window.eliminarConta = eliminarConta;
window.fecharLembrete = fecharLembrete;
window.salvarMeta = salvarMeta;
window.removerMeta = removerMeta;
window.pedirPermissaoNotificacao = pedirPermissaoNotificacao;

document.getElementById("salario")?.addEventListener("change", salvarSalario);
document.getElementById("bloco-notas")?.addEventListener("input", guardarLocal);

window.addEventListener("online", () => {
  atualizarSyncStatus();
  setTimeout(processarFila, 500);
});
window.addEventListener("offline", atualizarSyncStatus);
setInterval(() => {
  if (navigator.onLine && userId && !syncing) processarFila();
}, 30000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
