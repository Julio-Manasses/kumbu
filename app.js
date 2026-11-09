// ===== KUMBU - APP.JS v5.2 =====

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
  console.warn("Supabase indisponível.", e);
}

// ===== ESTADO =====
let categoriaAtual = "Igreja";
let mesAtual = new Date();
let dados = {};
let userId = null;
let userName = "Utilizador";
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
  } catch (e) {}
}
function lerLocal() {
  try {
    const raw = localStorage.getItem(LS_DADOS);
    if (raw) dados = JSON.parse(raw) || {};
  } catch (e) {
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
          await supabase
            .from("gastos")
            .insert({
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
// ===== AUTH E PERFIL =====
// ============================================================
async function criarConta() {
  if (!SUPABASE_OK) return mostrarMsg("Sem internet.");
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
  if (!SUPABASE_OK) return mostrarMsg("Sem internet.");
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
    await carregarPerfil();
    await recarregarDoServidor();
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
    `Benvindo, ${userName.split(" ")[0]}`;
  atualizar();
}

function mostrarMsg(txt) {
  document.getElementById("msg-login").innerText = txt;
}

// ============================================================
// ===== DADOS E INTERFACE =====
// ============================================================
async function recarregarDoServidor() {
  if (!SUPABASE_OK || !userId) return;
  try {
    const { data: orcs } = await supabase
      .from("orcamentos")
      .select("id, mes, ano, salario")
      .eq("user_id", userId);
    if (!orcs) return;
    for (const orc of orcs) {
      const chave = `${orc.ano}-${String(orc.mes).padStart(2, "0")}`;
      if (!dados[chave])
        dados[chave] = {
          salario: orc.salario || 0,
          gastos: [],
          agregado: "1 pessoa",
        };
      else if (!dados[chave].salario) dados[chave].salario = orc.salario;

      const { data: gastosDb } = await supabase
        .from("gastos")
        .select("id, nome, valor")
        .eq("orcamento_id", orc.id)
        .order("created_at", { ascending: true });
      if (gastosDb) {
        dados[chave].gastos = gastosDb.map((g) => ({
          id: g.id,
          nome: g.nome,
          valor: Number(g.valor),
          cat: "Outros",
        }));
      }
    }
    guardarLocal();
    atualizar();
  } catch (e) {}
}

(async () => {
  lerLocal();
  if (SUPABASE_OK) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        userId = data.session.user.id;
        await carregarPerfil();
        await recarregarDoServidor();
        abrirApp(data.session.user);
        setTimeout(processarFila, 800);
        return;
      }
    } catch (_) {}
  }
  atualizarSyncStatus();
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
}

async function limparTudo() {
  if (!confirm("Apagar todos os gastos DESTE mês?")) return;
  dadosDoMes().gastos = [];
  guardarLocal();
  if (userId) await enfileirarLimpeza(chaveMes(mesAtual));
  atualizar();
}

async function salvarSalario() {
  const salario = Number(document.getElementById("salario").value) || 0;
  dadosDoMes().salario = salario;
  guardarLocal();
  if (userId) await enfileirarSalario(salario, chaveMes(mesAtual));
  atualizar();
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
          ? `<i class="bi bi-cloud-arrow-up" style="color:#F59E0B;font-size:11px;"></i> `
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
      .join("") || "<p class='dica'>Nenhum gasto registado neste mês.</p>";
}

function renderGrafico() {
  const d = dadosDoMes();

  // Calcular Totais Globais (Todos os meses)
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

  // Gráfico do Mês Atual
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

// ============================================================
// ===== GESTÃO DE CONTA =====
// ============================================================
async function alterarSenha() {
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

async function eliminarConta() {
  if (
    !confirm(
      "TENS A CERTEZA? Todos os teus gastos, poupanças e dados serão APAGADOS PARA SEMPRE.",
    )
  )
    return;
  if (!confirm("Esta ação é irreversível. Deseja mesmo eliminar a conta?"))
    return;

  try {
    // No Supabase, o utilizador não pode apagar-se a si mesmo por segurança, a menos que tenha uma função RPC.
    // A forma correta e segura de fazer isso pelo frontend é pedir ao admin, ou usar uma função RPC que apague o auth.users.
    // Por agora, vamos apenas apagar os dados dele e fazer logout, para não dar erro.
    alert(
      "Por motivos de segurança, a eliminação definitiva da conta deve ser solicitada ao administrador. Os teus dados locais serão apagados.",
    );
    localStorage.clear();
    await sair();
  } catch (e) {
    alert("Erro: " + e.message);
  }
}

// ============================================================
// ===== EXPORTAR PDF e JSON =====
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
    doc.text("Conta Certa — Resumo Mensal", 15, 28);
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

function exportarJSON() {
  const dataStr =
    "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dados));
  const downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute(
    "download",
    `kumbu_backup_${Date.now()}.json`,
  );
  document.body.appendChild(downloadAnchorNode); // required for firefox
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

// ===== EXPOR =====
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
window.exportarJSON = exportarJSON;
window.alterarSenha = alterarSenha;
window.eliminarConta = eliminarConta;

document.getElementById("salario")?.addEventListener("change", salvarSalario);
window.addEventListener("online", () => {
  atualizarSyncStatus();
  setTimeout(processarFila, 500);
});
window.addEventListener("offline", atualizarSyncStatus);
setInterval(() => {
  if (navigator.onLine && userId && !syncing) processarFila();
}, 30000);

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js").catch(() => {});
