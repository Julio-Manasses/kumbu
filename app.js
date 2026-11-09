// ===== KUMBU - APP.JS v4 (com sync) =====
// Import dinâmico + try/catch: mesmo SEM internet o resto corre.

let supabase = null;
let SUPABASE_OK = false;

try {
  const { createClient } =
    await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm");
  const SUPABASE_URL = "https://TEU-PROJETO.supabase.co";
  const SUPABASE_KEY = "COLA-AQUI-A-TUA-CHAVE-ANON-PUBLIC";
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  SUPABASE_OK = true;
} catch (e) {
  console.warn("Supabase indisponível — modo offline forçado.", e);
}

// ===== ESTADO =====
let categoriaAtual = "Igreja";
let modoTeste = false;
let mesAtual = new Date();
let dados = {}; // { "2026-11": { salario, gastos[], poupancaMeta, agregado } }
let userId = null;
let syncing = false;

const LS_DADOS = "kumbu_dados_v4";
const LS_MODO = "kumbu_modo";

const gastosExemplo = [
  { nome: "Dízimo", valor: 15800, cat: "Igreja" },
  { nome: "Poupança", valor: 15800, cat: "Poupança" },
  { nome: "Arrendamento", valor: 25000, cat: "Casa" },
  { nome: "Alimentação", valor: 50000, cat: "Comida" },
  { nome: "Luz", valor: 10000, cat: "Casa" },
  { nome: "Água", valor: 20000, cat: "Casa" },
  { nome: "TV", valor: 9500, cat: "Casa" },
  { nome: "Gás", valor: 3000, cat: "Casa" },
  { nome: "Internet", valor: 6000, cat: "Casa" },
  { nome: "Oferta para o culto", valor: 3600, cat: "Igreja" },
  { nome: "Água purificada", valor: 3000, cat: "Casa" },
  { nome: "Produtos de higiene", valor: 5000, cat: "Casa" },
  { nome: "Farelo para galinha", valor: 5500, cat: "Outros" },
];

const iconesCat = {
  Igreja: "bi-bank",
  Casa: "bi-house-door",
  Comida: "bi-egg-fried",
  Transporte: "bi-bus-front",
  Poupança: "bi-piggy-bank",
  Outros: "bi-box-seam",
};

// ============================================================
// ===== INDEXEDDB — fila de operações pendentes =====
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

// ===== HELPERS DE MÊS =====
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
  if (!dados[k]) {
    dados[k] = {
      salario: 0,
      gastos: [],
      poupancaMeta: 0,
      agregado: "1 pessoa",
    };
  }
  return dados[k];
}

// ===== PERSISTÊNCIA =====
function guardarLocal() {
  try {
    localStorage.setItem(LS_DADOS, JSON.stringify(dados));
  } catch (e) {
    console.warn("Falha ao guardar:", e);
  }
}

function lerLocal() {
  try {
    const raw = localStorage.getItem(LS_DADOS);
    if (raw) dados = JSON.parse(raw) || {};
  } catch (e) {
    console.warn("Dados corrompidos, a reiniciar:", e);
    dados = {};
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
    el.title = "A sincronizar...";
  } else if (!online) {
    el.classList.add("offline");
    el.innerHTML = `<i class="bi bi-cloud-slash"></i>`;
    el.title = "Offline" + (pendentes ? ` — ${pendentes} pendentes` : "");
  } else if (pendentes > 0) {
    el.classList.add("pending");
    el.innerHTML = `<i class="bi bi-cloud-arrow-up"></i>`;
    el.title = `${pendentes} operações pendentes`;
  } else {
    el.classList.add("online");
    el.innerHTML = `<i class="bi bi-cloud-check"></i>`;
    el.title = "Sincronizado";
  }

  const info = document.getElementById("sync-info");
  if (info) {
    if (!SUPABASE_OK) info.innerText = "Servidor indisponível";
    else if (!online)
      info.innerText = `Offline${pendentes ? ` — ${pendentes} pendentes` : ""}`;
    else if (pendentes > 0)
      info.innerText = `${pendentes} operações por enviar`;
    else info.innerText = "Tudo sincronizado";
  }
}

// ============================================================
// ===== FILA — operações offline =====
// ============================================================
async function enfileirarGasto(gasto, chave) {
  if (!userId) return; // só faz sentido se houver conta online
  await enfileirar({ tipo: "add_gasto", user_id: userId, chave, gasto });
  await atualizarSyncStatus();
  tentarSincronizar();
}

async function enfileirarSalario(salario, chave) {
  if (!userId) return;
  await enfileirar({ tipo: "set_salario", user_id: userId, chave, salario });
  await atualizarSyncStatus();
  tentarSincronizar();
}

async function enfileirarAgregado(agregado, chave) {
  if (!userId) return;
  await enfileirar({ tipo: "set_agregado", user_id: userId, chave, agregado });
  await atualizarSyncStatus();
  tentarSincronizar();
}

async function enfileirarLimpeza(chave) {
  if (!userId) return;
  await enfileirar({ tipo: "limpar_gastos", user_id: userId, chave });
  await atualizarSyncStatus();
  tentarSincronizar();
}

// ============================================================
// ===== PROCESSAMENTO DA FILA =====
// ============================================================
async function processarFila() {
  if (!SUPABASE_OK || !navigator.onLine || syncing) return;
  if (!userId) {
    // Tenta obter sessão
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) userId = data.session.user.id;
      else return;
    } catch {
      return;
    }
  }

  syncing = true;
  await atualizarSyncStatus();

  try {
    const fila = await lerFila();

    for (const op of fila) {
      try {
        // Garante que existe orçamento para o mês
        const orcId = await garantirOrcamento(op.user_id, op.chave);

        if (op.tipo === "add_gasto") {
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
        } else if (op.tipo === "set_agregado") {
          // Coluna opcional — se não existir na BD, ignora o erro
          await supabase
            .from("orcamentos")
            .update({ agregado: op.agregado })
            .eq("id", orcId);
        } else if (op.tipo === "limpar_gastos") {
          await supabase.from("gastos").delete().eq("orcamento_id", orcId);
        }
        await removerDaFila(op.id);
      } catch (e) {
        console.warn("Operação falhou (fica na fila):", op.tipo, e);
        // Se falhou por rede, para o loop para não insistir
        if (!navigator.onLine) break;
      }
    }
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
// ===== AUTH =====
// ============================================================
async function criarConta() {
  if (!SUPABASE_OK) return mostrarMsg("Sem internet — usa o modo offline.");
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  const nome = document.getElementById("nome-user").value.trim();
  if (!email || !senha || senha.length < 6)
    return mostrarMsg("Escreve email e senha com 6+ caracteres");

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
    });
    if (error) return mostrarMsg("Erro: " + error.message);
    if (data.user) {
      await supabase.from("perfis").insert({
        id: data.user.id,
        nome: nome || email,
        telefone: "",
      });
    }
    mostrarMsg("Conta criada! Agora clica em Entrar");
  } catch (e) {
    mostrarMsg("Sem internet — usa o modo offline.");
  }
}

async function entrar() {
  if (!SUPABASE_OK) return mostrarMsg("Sem internet — usa o modo offline.");
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  if (!email || !senha) return mostrarMsg("Escreve email e senha");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });
    if (error) return mostrarMsg("Email ou senha errada");

    modoTeste = false;
    userId = data.user.id;
    localStorage.removeItem(LS_MODO);

    // Login → carrega do servidor mas faz merge com local
    await mergeComServidor();
    abrirApp(data.user);
    setTimeout(processarFila, 500);
  } catch (e) {
    mostrarMsg("Sem internet — usa o modo offline.");
  }
}

async function sair() {
  try {
    if (supabase) await supabase.auth.signOut();
  } catch (_) {}
  localStorage.removeItem(LS_MODO);
  // Mantém dados locais; fila fica para quando voltar
  location.reload();
}

function entrarSemConta() {
  modoTeste = true;
  localStorage.setItem(LS_MODO, "offline");
  lerLocal();

  if (Object.keys(dados).length === 0) {
    dados[chaveMes(new Date())] = {
      salario: 172000,
      gastos: [...gastosExemplo],
      poupancaMeta: 15800,
      agregado: "4 pessoas",
    };
    guardarLocal();
  }

  mesAtual = new Date();
  abrirApp({ email: "Modo Offline" });
  document.getElementById("nome-logado").innerText = "Modo Offline";
  atualizar();
  atualizarSyncStatus();
}

function abrirApp(user) {
  const telaLogin = document.getElementById("tela-login");
  if (telaLogin) telaLogin.style.display = "none";
  document.getElementById("app-principal").style.display = "block";
  document.getElementById("nome-logado").innerText = user.email;

  if (modoTeste) {
    atualizar();
  } else {
    // já fizemos merge antes; só atualiza UI
    atualizar();
  }
}

function mostrarMsg(txt) {
  const el = document.getElementById("msg-login");
  if (el) el.innerText = txt;
}

// ============================================================
// ===== MERGE ONLINE ↔ LOCAL =====
// ============================================================
async function mergeComServidor() {
  if (!SUPABASE_OK || !userId) return;

  try {
    const { data: orcs } = await supabase
      .from("orcamentos")
      .select("id, mes, ano, salario, agregado")
      .eq("user_id", userId);

    if (!orcs) return;

    // Para cada orçamento remoto, mescla com local
    for (const orc of orcs) {
      const chave = `${orc.ano}-${String(orc.mes).padStart(2, "0")}`;
      if (!dados[chave]) {
        dados[chave] = {
          salario: orc.salario || 0,
          gastos: [],
          poupancaMeta: 0,
          agregado: orc.agregado || "1 pessoa",
        };
      } else {
        // Local já tem este mês → mantém local mas usa salário remoto se local for 0
        if (!dados[chave].salario && orc.salario)
          dados[chave].salario = orc.salario;
      }

      const { data: gastosDb } = await supabase
        .from("gastos")
        .select("id, nome, valor")
        .eq("orcamento_id", orc.id)
        .order("created_at", { ascending: true });

      if (gastosDb && gastosDb.length > 0) {
        // Substitui os gastos locais se remotos tiverem mais
        if (
          !dados[chave].gastos ||
          dados[chave].gastos.length < gastosDb.length
        ) {
          dados[chave].gastos = gastosDb.map((g) => ({
            id: g.id,
            nome: g.nome,
            valor: Number(g.valor),
            cat: "Outros",
          }));
        }
      }
    }

    // Envia para servidor os meses que só existem localmente
    for (const chave of Object.keys(dados)) {
      const remoto = orcs.find(
        (o) => `${o.ano}-${String(o.mes).padStart(2, "0")}` === chave,
      );
      if (!remoto) {
        const [ano, mes] = chave.split("-").map(Number);
        const local = dados[chave];
        const { data: novo, error } = await supabase
          .from("orcamentos")
          .insert({ user_id: userId, mes, ano, salario: local.salario || 0 })
          .select()
          .single();
        if (!error && novo) {
          const inserts = (local.gastos || []).map((g) => ({
            user_id: userId,
            orcamento_id: novo.id,
            categoria_id: 1,
            nome: g.nome,
            valor: g.valor,
          }));
          if (inserts.length) await supabase.from("gastos").insert(inserts);
        }
      }
    }

    guardarLocal();
  } catch (e) {
    console.warn("Merge falhou (offline?):", e);
  }
}

// ============================================================
// ===== ARRANQUE =====
// ============================================================
(async () => {
  lerLocal();

  // Tenta restauro de sessão Supabase
  if (SUPABASE_OK) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        userId = data.session.user.id;
        await mergeComServidor();
        modoTeste = false;
        abrirApp(data.session.user);
        setTimeout(processarFila, 800);
        return;
      }
    } catch (_) {}
  }

  // Sem sessão → verifica se estava em modo offline
  if (localStorage.getItem(LS_MODO) === "offline") {
    modoTeste = true;
    if (Object.keys(dados).length === 0) {
      dados[chaveMes(new Date())] = {
        salario: 172000,
        gastos: [...gastosExemplo],
        poupancaMeta: 15800,
        agregado: "4 pessoas",
      };
      guardarLocal();
    }
    abrirApp({ email: "Modo Offline" });
    document.getElementById("nome-logado").innerText = "Modo Offline";
    atualizar();
    atualizarSyncStatus();
  } else {
    atualizarSyncStatus();
  }
})();

// ===== NAVEGAÇÃO =====
function mostrar(id, btn) {
  document
    .querySelectorAll(".tela")
    .forEach((t) => t.classList.remove("ativa"));
  const el = document.getElementById(id);
  if (el) el.classList.add("ativa");
  document
    .querySelectorAll(".menu button")
    .forEach((b) => b.classList.remove("ativo"));
  if (btn) btn.classList.add("ativo");
  if (id === "tela-grafico") renderGrafico();
  if (id === "tela-def") atualizarSyncStatus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function escolherCat(cat, el) {
  categoriaAtual = cat;
  document
    .querySelectorAll(".chip")
    .forEach((c) => c.classList.remove("ativo"));
  if (el) el.classList.add("ativo");
}

function mudarMes(delta) {
  mesAtual = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + delta, 1);
  atualizar();
  if (document.getElementById("tela-grafico")?.classList.contains("ativa"))
    renderGrafico();
}

// ===== GASTOS =====
async function adicionarGasto() {
  const nome = document.getElementById("nome").value.trim();
  const valor = Number(document.getElementById("valor").value);
  if (!nome || !valor) return alert("Escreve o nome e o valor");

  const chave = chaveMes(mesAtual);
  const d = dadosDoMes();
  const gasto = { nome, valor, cat: categoriaAtual, _pendente: true };
  d.gastos.push(gasto);
  guardarLocal();

  // Se tem conta, enfileira para sincronizar
  if (!modoTeste && userId) {
    await enfileirarGasto(gasto, chave);
  }

  document.getElementById("nome").value = "";
  document.getElementById("valor").value = "";
  atualizar();
  mostrar("tela-inicio", document.querySelector(".menu button"));
}

async function remover(i) {
  if (!confirm("Apagar este gasto?")) return;
  const chave = chaveMes(mesAtual);
  const d = dadosDoMes();
  const gasto = d.gastos[i];

  // Se tem id remoto, apaga no servidor (online) ou enfileira
  if (!modoTeste && SUPABASE_OK && gasto.id) {
    if (navigator.onLine) {
      try {
        await supabase.from("gastos").delete().eq("id", gasto.id);
      } catch (_) {
        await enfileirar({ tipo: "limpar_gastos", user_id: userId, chave });
      }
    } else {
      // Sem internet: apaga local e sinaliza limpeza (aproximação)
      await enfileirar({ tipo: "limpar_gastos", user_id: userId, chave });
    }
  }

  d.gastos.splice(i, 1);
  guardarLocal();
  atualizar();
}

async function limparTudo() {
  if (!confirm("Apagar todos os gastos DESTE mês?")) return;
  const chave = chaveMes(mesAtual);
  dadosDoMes().gastos = [];
  guardarLocal();
  if (!modoTeste && userId) await enfileirarLimpeza(chave);
  atualizar();
}

function carregarExemplo() {
  if (!confirm("Substituir os dados deste mês pelos exemplos?")) return;
  dados[chaveMes(mesAtual)] = {
    salario: 172000,
    gastos: [...gastosExemplo],
    poupancaMeta: 15800,
    agregado: "4 pessoas",
  };
  guardarLocal();
  atualizar();
  mostrar("tela-inicio", document.querySelector(".menu button"));
}

// ===== SALÁRIO =====
async function salvarSalario() {
  const salario = Number(document.getElementById("salario").value) || 0;
  const chave = chaveMes(mesAtual);
  dadosDoMes().salario = salario;
  guardarLocal();
  if (!modoTeste && userId) await enfileirarSalario(salario, chave);
  atualizar();
}

async function salvarAgregado() {
  const ag = document.getElementById("agregado").value;
  const chave = chaveMes(mesAtual);
  dadosDoMes().agregado = ag;
  guardarLocal();
  if (!modoTeste && userId) await enfileirarAgregado(ag, chave);
}

// ===== ATUALIZAR ECRÃ =====
function atualizar() {
  const d = dadosDoMes();
  const salario = Number(d.salario) || 0;
  const total = d.gastos.reduce((s, g) => s + Number(g.valor), 0);
  const poupanca = d.gastos
    .filter((g) => g.cat === "Poupança")
    .reduce((s, g) => s + Number(g.valor), 0);
  const saldo = salario - total;

  const lbl = document.getElementById("mes-label");
  if (lbl) lbl.innerText = nomeMes(mesAtual);
  const st = document.getElementById("mes-status");
  if (st) {
    const k = chaveMes(mesAtual);
    const hoje = chaveMes(new Date());
    st.innerText =
      k === hoje ? "Mês atual" : k < hoje ? "Mês passado" : "Mês futuro";
  }

  const salEl = document.getElementById("salario");
  if (salEl && salEl.value !== String(salario)) salEl.value = salario;
  const agEl = document.getElementById("agregado");
  if (agEl) agEl.value = d.agregado || "1 pessoa";

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
  if (alerta) {
    if (saldo < 0) {
      alerta.className = "alerta erro";
      alerta.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Passaste ${Math.abs(saldo).toLocaleString("pt-PT")} Kz!`;
    } else {
      alerta.className = "alerta ok";
      alerta.innerHTML = `<i class="bi bi-check-circle-fill"></i> Ainda tens ${saldo.toLocaleString("pt-PT")} Kz este mês.`;
    }
  }

  const lista = document.getElementById("lista-gastos");
  if (!lista) return;
  lista.innerHTML =
    d.gastos
      .slice()
      .reverse()
      .map((g, idx) => {
        const realIdx = d.gastos.length - 1 - idx;
        const icone = iconesCat[g.cat] || "bi-box-seam";
        const pend = g._pendente
          ? `<i class="bi bi-cloud-arrow-up" style="color:#F59E0B;font-size:11px;" title="Pendente"></i> `
          : "";
        return `<div class="item ${g._pendente ? "pendente" : ""}">
      <div>
        <b><i class="bi ${icone}"></i> ${g.nome}</b> ${pend}<br>
        <small>${g.cat}</small>
      </div>
      <div style="text-align:right">
        <b>${Number(g.valor).toLocaleString("pt-PT")} Kz</b>
        <button class="btn-del" onclick="remover(${realIdx})" aria-label="Remover">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>`;
      })
      .join("") || "<p class='dica'>Nenhum gasto ainda.</p>";
}

// ===== GRÁFICO =====
function renderGrafico() {
  const d = dadosDoMes();
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
    html += `<div class="barra-cat">
      <b><i class="bi ${iconesCat[cat] || "bi-box-seam"}"></i> ${cat} — ${perc}% — ${porCat[cat].toLocaleString("pt-PT")} Kz</b>
      <div class="barra-progresso"><div class="fill" style="width:${perc}%"></div></div>
    </div>`;
    resumo += `${cat}: ${porCat[cat].toLocaleString("pt-PT")} Kz (${perc}%)\n`;
  }

  document.getElementById("grafico").innerHTML = html || "<p>Sem dados.</p>";
  document.getElementById("resumo-cat").innerHTML = resumo
    ? `<pre>${resumo}</pre>`
    : "";
}

// ===== PDF =====
async function exportarPDF() {
  try {
    const { jsPDF } =
      await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js");
    const d = dadosDoMes();
    const salario = Number(d.salario) || 0;
    const total = d.gastos.reduce((s, g) => s + Number(g.valor), 0);
    const poupanca = d.gastos
      .filter((g) => g.cat === "Poupança")
      .reduce((s, g) => s + Number(g.valor), 0);

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
    doc.text("Conta Certa — Resumo Mensal", 15, 28);
    doc.text(nomeMes(mesAtual), 15, 35);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text("Resumo", 15, 55);
    doc.setFontSize(11);
    doc.setFont(undefined, "normal");
    let y = 63;
    doc.text(`Salario: ${salario.toLocaleString("pt-PT")} Kz`, 15, y);
    y += 7;
    doc.text(`Total Gasto: ${total.toLocaleString("pt-PT")} Kz`, 15, y);
    y += 7;
    doc.text(`Poupanca: ${poupanca.toLocaleString("pt-PT")} Kz`, 15, y);
    y += 7;
    doc.setFont(undefined, "bold");
    const saldo = salario - total;
    doc.setTextColor(saldo < 0 ? 200 : 0, saldo < 0 ? 0 : 128, 0);
    doc.text(`Saldo: ${saldo.toLocaleString("pt-PT")} Kz`, 15, y);
    y += 12;

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text("Gastos", 15, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    if (d.gastos.length === 0) {
      doc.text("(nenhum gasto registado)", 15, y);
    } else {
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
    }

    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Gerado em ${new Date().toLocaleDateString("pt-PT")} — Kumbu PWA`,
      15,
      290,
    );

    const nomeFicheiro = `Kumbu_${nomeMes(mesAtual).replace(" ", "_")}.pdf`;
    const blob = doc.output("blob");
    const file = new File([blob], nomeFicheiro, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `Kumbu — ${nomeMes(mesAtual)}`,
          text: "Resumo do orçamento",
        });
        return;
      } catch (e) {
        if (e.name !== "AbortError") console.warn("Share falhou:", e);
      }
    }
    doc.save(nomeFicheiro);
  } catch (e) {
    console.error(e);
    alert(
      "Não consegui gerar o PDF. Verifica se tens internet (primeira vez).",
    );
  }
}

async function partilharResumo() {
  const d = dadosDoMes();
  const salario = Number(d.salario) || 0;
  const total = d.gastos.reduce((s, g) => s + Number(g.valor), 0);

  let txt = `ORÇAMENTO — KUMBU\n${nomeMes(mesAtual)}\n\n`;
  txt += `Salário: ${salario.toLocaleString("pt-PT")} Kz\n`;
  txt += `Total Gasto: ${total.toLocaleString("pt-PT")} Kz\n`;
  txt += `Saldo: ${(salario - total).toLocaleString("pt-PT")} Kz\n\n`;
  d.gastos.forEach((g) => {
    txt += `• ${g.nome} [${g.cat}] — ${Number(g.valor).toLocaleString("pt-PT")} Kz\n`;
  });

  if (navigator.share) {
    try {
      await navigator.share({ title: "Kumbu", text: txt });
      return;
    } catch (_) {}
  }
  await navigator.clipboard.writeText(txt);
  alert("Resumo copiado!");
}

// ===== BACKUP =====
function exportarJSON() {
  const blob = new Blob([JSON.stringify(dados, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kumbu_backup_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importarJSON(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const novo = JSON.parse(e.target.result);
      if (typeof novo !== "object") throw new Error("Formato inválido");
      if (!confirm("Substituir TODOS os dados pelos do ficheiro?")) return;
      dados = novo;
      guardarLocal();
      atualizar();
      alert("Importado com sucesso!");
    } catch (err) {
      alert("Ficheiro inválido: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ===== SYNC MANUAL =====
async function forcarSincronizacao() {
  if (!SUPABASE_OK) return alert("Sem servidor configurado.");
  if (!navigator.onLine) return alert("Sem internet.");
  if (!userId) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) userId = data.session.user.id;
      else return alert("Entra na tua conta primeiro.");
    } catch {
      return alert("Não consegui validar a sessão.");
    }
  }
  await mergeComServidor();
  await processarFila();
  alert("Sincronização concluída!");
}

// ===== EXPOR =====
window.criarConta = criarConta;
window.entrar = entrar;
window.sair = sair;
window.entrarSemConta = entrarSemConta;
window.mostrar = mostrar;
window.escolherCat = escolherCat;
window.mudarMes = mudarMes;
window.adicionarGasto = adicionarGasto;
window.remover = remover;
window.limparTudo = limparTudo;
window.carregarExemplo = carregarExemplo;
window.exportarPDF = exportarPDF;
window.partilharResumo = partilharResumo;
window.exportarJSON = exportarJSON;
window.importarJSON = importarJSON;
window.forcarSincronizacao = forcarSincronizacao;

// ===== EVENTOS =====
document.getElementById("salario")?.addEventListener("change", salvarSalario);
document.getElementById("salario")?.addEventListener("input", () => {
  dadosDoMes().salario = Number(document.getElementById("salario").value) || 0;
  guardarLocal();
  atualizar();
});
document.getElementById("agregado")?.addEventListener("change", salvarAgregado);

// ===== EVENTOS DE REDE =====
window.addEventListener("online", async () => {
  console.log("[KUMBU] online — a sincronizar...");
  await atualizarSyncStatus();
  setTimeout(processarFila, 500);
});

window.addEventListener("offline", () => {
  console.log("[KUMBU] offline");
  atualizarSyncStatus();
});

// ===== SYNC PERIÓDICO (a cada 30s se online) =====
setInterval(() => {
  if (navigator.onLine && userId && !syncing) {
    processarFila();
    atualizarSyncStatus();
  }
}, 30000);

// ===== SERVICE WORKER =====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .catch((err) => console.warn("SW:", err));
}

// ===== BG SYNC (se o browser suportar) =====
if ("serviceWorker" in navigator && "SyncManager" in window) {
  navigator.serviceWorker.ready.then((reg) => {
    reg.sync.register("kumbu-sync").catch(() => {});
  });
}
