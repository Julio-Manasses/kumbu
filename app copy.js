let categoriaAtual = "Igreja";
let gastos = JSON.parse(localStorage.getItem("kumbu_gastos")) || [
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
let salarioSalvo = localStorage.getItem("kumbu_salario") || 172000;
document.getElementById("salario").value = salarioSalvo;

function salvar() {
  localStorage.setItem("kumbu_gastos", JSON.stringify(gastos));
  localStorage.setItem(
    "kumbu_salario",
    document.getElementById("salario").value,
  );
}
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
}
function escolherCat(cat, el) {
  categoriaAtual = cat;
  document
    .querySelectorAll(".chip")
    .forEach((c) => c.classList.remove("ativo"));
  el.classList.add("ativo");
}
function adicionarGasto() {
  const nome = document.getElementById("nome").value.trim();
  const valor = Number(document.getElementById("valor").value);
  if (!nome || !valor) return alert("Escreve o nome e o valor");
  gastos.push({ nome, valor, cat: categoriaAtual });
  document.getElementById("nome").value = "";
  document.getElementById("valor").value = "";
  salvar();
  atualizar();
  mostrar("tela-inicio", document.querySelector(".menu button"));
  alert("Gasto guardado!");
}
function remover(i) {
  if (confirm("Apagar este gasto?")) {
    gastos.splice(i, 1);
    salvar();
    atualizar();
  }
}
function limparTudo() {
  if (confirm("Apagar tudo?")) {
    gastos = [];
    salvar();
    atualizar();
  }
}
function carregarExemplo() {
  localStorage.clear();
  location.reload();
}

function atualizar() {
  const salario = Number(document.getElementById("salario").value) || 0;
  const total = gastos.reduce((s, g) => s + g.valor, 0);
  const poupanca = gastos
    .filter((g) => g.cat === "Poupança")
    .reduce((s, g) => s + g.valor, 0);
  const saldo = salario - total;
  document.getElementById("totalGasto").innerText =
    total.toLocaleString() + " Kz";
  document.getElementById("saldo").innerText = saldo.toLocaleString() + " Kz";
  document.getElementById("poupanca").innerText =
    poupanca.toLocaleString() + " Kz";
  document.getElementById("barra").style.width =
    Math.min(100, (total / salario) * 100) + "%";
  document.getElementById("barra").style.background =
    saldo < 0 ? "#ef4444" : "#D4AF37";

  // SEM EMOJI - com Bootstrap Icons
  document.getElementById("alerta").innerHTML =
    saldo < 0
      ? `<i class="bi bi-exclamation-triangle-fill"></i> Passaste ${Math.abs(saldo).toLocaleString()} Kz! Tens de cortar.`
      : `<i class="bi bi-check-circle-fill"></i> Ainda tens ${saldo.toLocaleString()} Kz para o mês.`;

  const lista = document.getElementById("lista-gastos");
  const iconesCat = {
    Igreja: "bi-bank",
    Casa: "bi-house-door",
    Comida: "bi-egg-fried",
    Transporte: "bi-bus-front",
    Poupança: "bi-piggy-bank",
    Outros: "bi-box-seam",
  };
  lista.innerHTML =
    gastos
      .slice()
      .reverse()
      .map((g, idx) => {
        const realIdx = gastos.length - 1 - idx;
        const icone = iconesCat[g.cat] || "bi-box-seam";
        return `<div class="item"><div><b><i class="bi ${icone}"></i> ${g.nome}</b><br><small>${g.cat}</small></div><div><b>${g.valor.toLocaleString()} Kz</b> <button class="btn-del" onclick="remover(${realIdx})"><i class="bi bi-trash"></i></button></div></div>`;
      })
      .join("") || "<p>Nenhum gasto ainda.</p>";
  salvar();
}

function renderGrafico() {
  const total = gastos.reduce((s, g) => s + g.valor, 0) || 1;
  const porCat = {};
  gastos.forEach((g) => (porCat[g.cat] = (porCat[g.cat] || 0) + g.valor));
  const iconesCat = {
    Igreja: "bi-bank",
    Casa: "bi-house-door",
    Comida: "bi-egg-fried",
    Transporte: "bi-bus-front",
    Poupança: "bi-piggy-bank",
    Outros: "bi-box-seam",
  };
  let html = "";
  let resumo = "";
  for (let cat in porCat) {
    const perc = ((porCat[cat] / total) * 100).toFixed(1);
    html += `<div class="barra-cat"><b><i class="bi ${iconesCat[cat]}"></i> ${cat} - ${perc}% - ${porCat[cat].toLocaleString()} Kz</b><div class="barra-progresso"><div class="fill" style="width:${perc}%"></div></div></div>`;
    resumo += `${cat}: ${porCat[cat].toLocaleString()} Kz (${perc}%)\n`;
  }
  document.getElementById("grafico").innerHTML = html;
  document.getElementById("resumo-cat").innerHTML = `<pre>${resumo}</pre>`;
}
function exportar() {
  const salario = document.getElementById("salario").value;
  const total = gastos.reduce((s, g) => s + g.valor, 0);
  let txt = `ORÇAMENTO MENSAL - KUMBU\nSalário: ${Number(salario).toLocaleString()} Kz\nTotal Gasto: ${total.toLocaleString()} Kz\nSaldo: ${(salario - total).toLocaleString()} Kz\n\n`;
  gastos.forEach(
    (g) => (txt += `${g.nome} - ${g.valor.toLocaleString()} Kz\n`),
  );
  document.getElementById("exportado").innerText = txt;
}
document.getElementById("salario").addEventListener("input", atualizar);
atualizar();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
