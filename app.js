// ===== KUMBU - APP.JS v5 (Cloud + Offline Sync) =====

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
  console.warn("Supabase indisponível — modo offline forçado.", e);
}

// ===== ESTADO =====
let categoriaAtual = "Igreja";
let mesAtual = new Date();
let dados = {}; // Cache local: { "2026-11": { salario, gastos[], agregado } }
let userId = null;
let syncing = false;

const LS_DADOS = "kumbu_dados_v5";

const iconesCat = {
  Igreja: "bi-bank",
  Casa: "bi-house-door",
  Comida: "bi-egg-fried",
  Transporte: "bi-bus-front",
  Poupança: "bi-piggy-bank",
  Outros: "bi-box-seam",
};

// ============================================================
// ===== INDEXEDDB — Fila para sincronização offline =====
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
    dados[k] = { salario: 0, gastos: [], agregado: "1 pessoa" };
  }
  return dados[k];
}

// ===== PERSISTÊNCIA LOCAL =====
function guardarLocal() {
  try {
    localStorage.setItem(LS_DADOS, JSON.stringify(dados));
  } catch (e) {
    console.warn("Falha ao guardar cache:", e);
  }
}

function lerLocal() {
  try {
    const raw = localStorage.getItem(LS_DADOS);
    if (raw) dados = JSON.parse(raw) || {};
  } catch (e) {
    console.warn("Cache corrompida, a reiniciar:", e);
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
    else info.innerText = "Tudo sincronizado com a nuvem";
  }
}

// ============================================================
// ===== FILA DE OPERAÇÕES =====
// ============================================================
async function enfileirarGasto(gasto, chave) {
  if (!userId) return;
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

async function tentarSincronizar() {
  if (navigator.onLine && userId && !syncing) processarFila();
}

// ============================================================
// ===== PROCESSAMENTO DA FILA =====
// ============================================================
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
          await supabase.from("gastos").insert({
            user_id: op.user_id,
            orcamento_id: orcId,
            categoria_id: 1, // Como não temos o ID da categoria na fila, usamos o default "1"
            nome: op.gasto.nome,
            valor: op.gasto.valor,
          });
        } else if (op.tipo === "set_salario") {
          await supabase
            .from("orcamentos")
            .update({ salario: op.salario })
            .eq("id", orcId);
        } else if (op.tipo === "set_agregado") {
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
        if (!navigator.onLine) break;
      }
    }

    // Depois de processar a fila, recarrega os dados para garantir que o que está no ecrã corresponde à BD
    await recarregarDoServidor();
  } catch (e) {
    console.error("Erro ao processar fila:", e);
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
// ===== AUTH (LOGIN / CONTA) =====
// ============================================================
async function criarConta() {
  if (!SUPABASE_OK)
    return mostrarMsg("Sem internet — não é possível criar conta.");
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
    mostrarMsg("Conta criada! Clica em Entrar.");
  } catch (e) {
    mostrarMsg("Erro ao ligar ao servidor.");
  }
}

async function entrar() {
  if (!SUPABASE_OK)
    return mostrarMsg("Sem internet — não é possível entrar agora.");
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  if (!email || !senha) return mostrarMsg("Escreve email e senha");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });
    if (error) return mostrarMsg("Email ou senha errada");

    userId = data.user.id;
    mostrarMsg("A entrar...");

    // Ao entrar, o app liga-se à BD, puxa os dados e processa o que estiver offline
    await recarregarDoServidor();
    abrirApp(data.user);
    setTimeout(processarFila, 500);
  } catch (e) {
    mostrarMsg("Sem internet — tenta novamente mais tarde.");
  }
}

async function sair() {
  try {
    if (supabase) await supabase.auth.signOut();
  } catch (_) {}
  // Mantemos o cache local (dados) mas o utilizador precisa de fazer login de novo
  location.reload();
}

function abrirApp(user) {
  document.getElementById("tela-login").style.display = "none";
  document.getElementById("app-principal").style.display = "block";
  document.getElementById("nome-logado").innerText = user.email;
  atualizar();
}

function mostrarMsg(txt) {
  const el = document.getElementById("msg-login");
  if (el) el.innerText = txt;
}

// ============================================================
// ===== PUXAR DADOS DO SERVIDOR =====
// ============================================================
async function recarregarDoServidor() {
  if (!SUPABASE_OK || !userId) return;

  try {
    const { data: orcs } = await supabase
      .from("orcamentos")
      .select("id, mes, ano, salario, agregado")
      .eq("user_id", userId);

    if (!orcs) return;

    for (const orc of orcs) {
      const chave = `${orc.ano}-${String(orc.mes).padStart(2, "0")}`;

      // Se já tivermos dados locais deste mês, só preenchemos se o local estiver vazio
      if (!dados[chave]) {
        dados[chave] = {
          salario: orc.salario || 0,
          gastos: [],
          agregado: orc.agregado || "1 pessoa",
        };
      } else if (!dados[chave].salario) {
        dados[chave].salario = orc.salario;
      }

      const { data: gastosDb } = await supabase
        .from("gastos")
        .select("id, nome, valor")
        .eq("orcamento_id", orc.id)
        .order("created_at", { ascending: true });

      if (gastosDb) {
        // Substitui os gastos pelo que está na base de dados (a BD é a fonte da verdade)
        dados[chave].gastos = gastosDb.map((g) => ({
          id: g.id,
          nome: g.nome,
          valor: Number(g.valor),
          cat: "Outros", // Categoria genérica (podes melhorar isto depois guardando o categoria_id)
        }));
      }
    }

    guardarLocal();
    atualizar(); // Atualiza o ecrã com os dados frescos
  } catch (e) {
    console.warn("Falha ao puxar do servidor (offline?):", e);
  }
}

// ============================================================
// ===== ARRANQUE DO APP =====
// ============================================================
(async () => {
  lerLocal(); // Carrega o que estava no telefone (para ver algo instantâneo)

  if (SUPABASE_OK) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        userId = data.session.user.id;
        await recarregarDoServidor();
        abrirApp(data.session.user);
        setTimeout(processarFila, 800);
        return;
      }
    } catch (_) {}
  }

  // Se não estiver logado, mostra a tela de login
  atualizarSyncStatus();
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

// ===== AÇÕES (GASTOS / SALÁRIO) =====
async function adicionarGasto() {
  const nome = document.getElementById("nome").value.trim();
  const valor = Number(document.getElementById("valor").value);
  if (!nome || !valor) return alert("Escreve o nome e o valor");

  const chave = chaveMes(mesAtual);
  const d = dadosDoMes();
  const gasto = { nome, valor, cat: categoriaAtual, _pendente: true };

  // Atualiza no ecrã imediatamente
  d.gastos.push(gasto);
  guardarLocal();

  // Se tem conta, enfileira para enviar para o Supabase
  if (userId) {
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

  // Se o gasto tem ID, apaga no servidor
  if (userId && gasto.id) {
    if (navigator.onLine) {
      try {
        await supabase.from("gastos").delete().eq("id", gasto.id);
      } catch (_) {
        await enfileirar({ tipo: "limpar_gastos", user_id: userId, chave });
      }
    } else {
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
  if (userId) await enfileirarLimpeza(chave);
  atualizar();
}

async function salvarSalario() {
  const salario = Number(document.getElementById("salario").value) || 0;
  const chave = chaveMes(mesAtual);
  dadosDoMes().salario = salario;
  guardarLocal();
  if (userId) await enfileirarSalario(salario, chave);
  atualizar();
}

async function salvarAgregado() {
  const ag = document.getElementById("agregado").value;
  const chave = chaveMes(mesAtual);
  dadosDoMes().agregado = ag;
  guardarLocal();
  if (userId) await enfileirarAgregado(ag, chave);
}

// ===== INTERFACE (ATUALIZAR ECRÃ) =====
function atualizar() {
  const d = dadosDoMes();
  const salario = Number(d.salario) || 0;
  const total = d.gastos.reduce((s, g) => s + Number(g.valor), 0);
  const poupanca = d.gastos
    .filter((g) => g.cat === "Poupança")
    .reduce((s, g) => s + Number(g.valor), 0);
  const saldo = salario - total;

  // Datas
  document.getElementById("mes-label").innerText = nomeMes(mesAtual);
  const k = chaveMes(mesAtual);
  const hoje = chaveMes(new Date());
  document.getElementById("mes-status").innerText =
    k === hoje ? "Mês atual" : k < hoje ? "Mês passado" : "Mês futuro";

  // Inputs
  document.getElementById("salario").value = salario;
  document.getElementById("agregado").value = d.agregado || "1 pessoa";

  // Cards
  document.getElementById("totalGasto").innerText =
    total.toLocaleString("pt-PT") + " Kz";
  document.getElementById("saldo").innerText =
    saldo.toLocaleString("pt-PT") + " Kz";
  document.getElementById("poupanca").innerText =
    poupanca.toLocaleString("pt-PT") + " Kz";

  // Barra
  const barra = document.getElementById("barra");
  if (barra) {
    barra.style.width =
      Math.min(100, salario > 0 ? (total / salario) * 100 : 0) + "%";
    barra.style.background =
      saldo < 0
        ? "linear-gradient(90deg,#EF4444,#F87171)"
        : "linear-gradient(90deg,#D4AF37,#F4D03F)";
  }

  // Alerta
  const alerta = document.getElementById("alerta");
  if (saldo < 0) {
    alerta.className = "alerta erro";
    alerta.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Passaste ${Math.abs(saldo).toLocaleString("pt-PT")} Kz!`;
  } else {
    alerta.className = "alerta ok";
    alerta.innerHTML = `<i class="bi bi-check-circle-fill"></i> Ainda tens ${saldo.toLocaleString("pt-PT")} Kz este mês.`;
  }

  // Lista de Gastos
  const lista = document.getElementById("lista-gastos");
  lista.innerHTML =
    d.gastos
      .slice()
      .reverse()
      .map((g, idx) => {
        const realIdx = d.gastos.length - 1 - idx;
        const icone = iconesCat[g.cat] || "bi-box-seam";
        const pend = g._pendente
          ? `<i class="bi bi-cloud-arrow-up" style="color:#F59E0B;font-size:11px;" title="A enviar..."></i> `
          : "";
        return `
        <div class="item ${g._pendente ? "pendente" : ""}">
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
        </div>
      `;
      })
      .join("") || "<p class='dica'>Nenhum gasto registado neste mês.</p>";
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
    html += `
      <div class="barra-cat">
        <b><i class="bi ${iconesCat[cat] || "bi-box-seam"}"></i> ${cat} — ${perc}% — ${porCat[cat].toLocaleString("pt-PT")} Kz</b>
        <div class="barra-progresso"><div class="fill" style="width:${perc}%"></div></div>
      </div>`;
    resumo += `${cat}: ${porCat[cat].toLocaleString("pt-PT")} Kz (${perc}%)\n`;
  }

  document.getElementById("grafico").innerHTML =
    html || "<p>Sem dados para este mês.</p>";
  document.getElementById("resumo-cat").innerHTML = resumo
    ? `<pre>${resumo}</pre>`
    : "";
}

// ===== EXPORTAR E PARTILHAR =====
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
    alert("Não consegui gerar o PDF. Verifica a tua ligação à internet.");
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
  alert("Resumo copiado para a área de transferência!");
}

async function forcarSincronizacao() {
  if (!SUPABASE_OK) return alert("Sem servidor configurado.");
  if (!navigator.onLine) return alert("Sem internet.");
  if (!userId) return alert("Entra na tua conta primeiro.");

  await processarFila();
  await recarregarDoServidor();
  alert("Sincronização concluída com sucesso!");
}

// ===== EXPOR PARA O HTML =====
window.criarConta = criarConta;
window.entrar = entrar;
window.sair = sair;
window.mostrar = mostrar;
window.escolherCat = escolherCat;
window.mudarMes = mudarMes;
window.adicionarGasto = adicionarGasto;
window.remover = remover;
window.limparTudo = limparTudo;
window.exportarPDF = exportarPDF;
window.partilharResumo = partilharResumo;
window.forcarSincronizacao = forcarSincronizacao;

// ===== EVENTOS =====
document.getElementById("salario")?.addEventListener("change", salvarSalario);
document.getElementById("salario")?.addEventListener("input", () => {
  dadosDoMes().salario = Number(document.getElementById("salario").value) || 0;
  guardarLocal();
  atualizar();
});
document.getElementById("agregado")?.addEventListener("change", salvarAgregado);

window.addEventListener("online", async () => {
  await atualizarSyncStatus();
  setTimeout(processarFila, 500);
});

window.addEventListener("offline", () => {
  atualizarSyncStatus();
});

setInterval(() => {
  if (navigator.onLine && userId && !syncing) {
    processarFila();
  }
}, 30000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .catch((err) => console.warn("SW:", err));
}
if ("serviceWorker" in navigator && "SyncManager" in window) {
  navigator.serviceWorker.ready.then((reg) => {
    reg.sync.register("kumbu-sync").catch(() => {});
  });
}
