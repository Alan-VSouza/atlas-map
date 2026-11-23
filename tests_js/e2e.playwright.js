// Teste ponta a ponta no navegador. Rode com o site servido em http://127.0.0.1:8765/ :
//   playwright-cli open --browser=chrome http://127.0.0.1:8765/
//   playwright-cli run-code --filename=tests_js/e2e.playwright.js
// Grava screenshots em shots/ e devolve um relatório JSON com cada verificação.
async (page) => {
  const BASE = globalThis.ATLAS_URL || "http://127.0.0.1:8765/";
  const report = { checks: [], console: [], shots: [] };
  const ok = (name, pass, info) => report.checks.push({ name, pass: !!pass, info });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") report.console.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => report.console.push("pageerror: " + e.message + " @ " + (e.stack || "").split(String.fromCharCode(10)).slice(1, 3).join(" <- ").trim()));
  const wait = (ms) => page.waitForTimeout(ms);
  const ready = () => page.waitForFunction(() => window.__atlas && window.__atlas.map && window.__atlas.state, null, { timeout: 15000 });
  const shot = async (name) => { const p = `shots/${name}.png`; await page.screenshot({ path: p }); report.shots.push(p); };
  const S = () => page.evaluate(() => window.__atlas.state);

  async function visibleNodes() {
    return page.evaluate(() => {
      const a = window.__atlas, out = [];
      for (let n = 0; n < a.map.nodes.length; n++) { const [x, y] = a.node(n); if (a.visible(x, y) && !a.map.hospitals.includes(n)) out.push([n, x, y]); }
      return out;
    });
  }

  // ---------------------------------------------------------------- desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.goto(BASE);
  await ready(); await wait(900);
  ok("tour aparece na primeira visita", await page.isVisible("#tour .tour-card"));
  await shot("desk-day-tour");
  await page.click("#tour-next"); await wait(300); await page.click("#tour-next"); await wait(300);
  ok("tour chega ao passo 3", (await page.textContent("#tour-step")).includes("3 de 3"));
  await page.click("#tour-next"); await wait(200);
  ok("tour some ao terminar", !(await page.isVisible("#tour .tour-card")));
  await page.reload(); await ready(); await wait(900);
  ok("tour não volta depois de dispensado", !(await page.isVisible("#tour .tour-card")));

  // rota
  const nodes = await visibleNodes();
  const a = nodes[0], b = nodes[nodes.length - 1];
  await page.mouse.click(a[1], a[2]); await wait(150); await page.mouse.click(b[1], b[2]); await wait(400);
  const route = await page.evaluate(() => window.__atlas.route);
  ok("rota traçada entre dois cruzamentos", route && route.found && route.path.length > 2, route && { src: route.src, dst: route.dst, dijkstra: route.dijkstra_settled, astar: route.astar_expanded });
  ok("cartão da rota mostra tempo", /min/.test(await page.textContent("#routecard")));
  ok("A* visita menos nós que Dijkstra", route && route.astar_expanded <= route.dijkstra_settled);
  const an = await page.evaluate(() => window.__atlas.anim);
  ok("animação da busca usa os mesmos nós da rota", an && an.dijkstra === route.dijkstra_settled && an.astar === route.astar_expanded && !an.done, an);
  await wait(900); await shot("desk-day-busca-anim");
  await page.waitForFunction(() => !window.__atlas.anim || window.__atlas.anim.done, null, { timeout: 10000 });
  ok("animação termina e a rota aparece", /nós/.test(await page.textContent("#routecard")));
  await shot("desk-day-rota");
  await page.click("#routecard .link-btn"); await wait(300);
  ok("botão Ver a busca de novo reinicia a animação", !!(await page.evaluate(() => window.__atlas.anim)));
  await page.waitForFunction(() => !window.__atlas.anim || window.__atlas.anim.done, null, { timeout: 10000 });
  ok("cartão da rota mostra o efeito do trânsito", /trânsito|livre/i.test(await page.textContent("#routecard .traffic-note")));
  await page.click("#btn-layers"); await page.click("#traffic-routing"); await wait(900);
  ok("desligar: rotas ignoram o trânsito", (await S()).traffic_routing === false && /ignorando/.test(await page.textContent("#routecard")));
  await page.click("#traffic-routing"); await wait(900);
  ok("religar: rotas voltam a considerar o trânsito", (await S()).traffic_routing === true);
  await page.keyboard.press("Escape");
  // espera o trânsito formar e procura um par em que a rota desvia
  await wait(6000);
  const pair = await page.evaluate(async () => {
    const a = window.__atlas, vis = [];
    for (let n = 0; n < a.map.nodes.length; n++) { const [x, y] = a.node(n); if (a.visible(x, y)) vis.push(n); }
    for (let i = 0; i < vis.length; i += 3) for (let j = vis.length - 1; j > i; j -= 5) {
      const r = await a.call("route", { src: vis[i], dst: vis[j] });
      if (r.found && r.free_path.join() !== r.path.join()) return [vis[i], vis[j]];
    }
    return null;
  });
  ok("o trânsito faz alguma rota desviar", !!pair, pair);
  if (pair) {
    await page.click("#routecard .close").catch(() => {});
    const [p1, p2] = await page.evaluate((pr) => [window.__atlas.node(pr[0]), window.__atlas.node(pr[1])], pair);
    await page.mouse.click(...p1); await wait(150); await page.mouse.click(...p2);
    await page.waitForFunction(() => window.__atlas.anim, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !window.__atlas.anim || window.__atlas.anim.done, null, { timeout: 10000 });
    await wait(400);
    const note = await page.textContent("#routecard .traffic-note");
    ok("cartão explica o desvio (ou o trânsito mudou de novo)", /Desviou|Trânsito|livre/.test(note), note);
    await shot("desk-day-desvio");
  }

  // tutor
  await page.click("#btn-tutor"); await wait(150);
  ok("modo tutor liga", await page.isVisible("#tutor"));

  // chamado + ambulância atende
  await page.click("[data-tool=call]"); await page.click("[data-sev='5']");
  const before = await S();
  const resolvedBefore = before.stats.resolved;
  const target = nodes[Math.floor(nodes.length / 2)];
  await page.mouse.click(target[1], target[2]); await wait(500);
  let st = await S();
  const mine = st.emergencies.find((e) => e.node === target[0] && e.severity === 5);
  ok("chamado criado no nó clicado", !!mine, mine);
  await page.click("#t-chamados"); await page.click("#heap-block summary"); await wait(400);
  await shot("desk-day-chamado");
  let served = false, sawAssigned = false;
  for (let i = 0; i < 160 && mine; i++) {
    await wait(250); st = await S();
    const e = st.emergencies.find((x) => x.id === mine.id);
    if (e && e.state !== "waiting") sawAssigned = true;
    if (!e && st.stats.resolved > resolvedBefore) { served = true; break; }
  }
  ok("ambulância foi despachada", sawAssigned);
  ok("ambulância atendeu e levou ao hospital", served, { resolved: st.stats.resolved, tick: st.tick });

  // fechar rua + desfazer
  await page.click("#t-resumo");
  await page.click("[data-tool=road]");
  const edgeId = await page.evaluate(() => {
    const a = window.__atlas;
    for (const e of a.map.edges) { const [x, y] = a.edge(e.id); if (a.visible(x, y)) return e.id; }
    return null;
  });
  const [ex, ey] = await page.evaluate((id) => window.__atlas.edge(id), edgeId);
  await page.mouse.click(ex, ey); await wait(500);
  st = await S();
  ok("rua fechada", st.closed.includes(edgeId), { edgeId, closed: st.closed });
  ok("desfazer habilitado", !(await page.isDisabled("#btn-undo")));
  await shot("desk-day-via-fechada");
  await page.click("#btn-undo"); await wait(400);
  st = await S();
  ok("desfazer reabre a rua", !st.closed.includes(edgeId) && st.redo === 1, { closed: st.closed, redo: st.redo });
  await page.click("#btn-redo"); await wait(300); st = await S();
  ok("refazer fecha de novo", st.closed.includes(edgeId));
  await page.click("#btn-undo"); await wait(300);

  // busca com erro de digitação
  await page.click("[data-tool=route]");
  const street = await page.evaluate(() => window.__atlas.map.cols.find((c) => c.length > 11) || window.__atlas.map.cols[0]);
  const typo = street.toLowerCase().slice(0, 8) + "x" + street.toLowerCase().slice(9, 12);
  await page.fill("#ac", typo); await wait(500);
  const list = await page.textContent("#ac-list");
  ok("busca com erro sugere a rua certa (Levenshtein)", list.includes("Você quis dizer") && list.includes(street), { typo, street, list: list.slice(0, 160) });
  await shot("desk-day-busca");
  await page.click("#ac-list [role=option]"); await wait(300);
  ok("selecionar sugestão preenche a busca", (await page.inputValue("#ac")) === street);
  await page.fill("#ac", "av"); await wait(400);
  ok("autocompletar por prefixo (Trie)", (await page.$$("#ac-list [role=option]")).length > 0);
  await page.keyboard.press("Escape");

  // morador
  await page.click("#t-estruturas"); await page.click("#res-block summary"); await wait(200);
  await page.click("#rid-samples button"); await wait(400);
  const res = await page.textContent("#res-info");
  ok("consulta de morador existente (Bloom + AVL)", /mora em/.test(res), res);
  await page.fill("#rid", "99999"); await page.click("#res-form button"); await wait(300);
  ok("morador inexistente: Bloom diz com certeza não ou AVL confirma", /Não existe/.test(await page.textContent("#res-info")));

  // benchmark
  await page.click("#bench-block summary"); await page.click("#btn-bench");
  await page.waitForFunction(() => /Pronto/.test(document.querySelector("#bench-status").textContent), null, { timeout: 60000 });
  const charts = await page.$$("#bench .chart canvas");
  ok("benchmark roda no navegador e desenha gráficos", charts.length >= 6, { charts: charts.length, status: await page.textContent("#bench-status") });
  await page.$eval("#bench-block", (el) => el.scrollIntoView());
  await shot("desk-day-bench");

  // desempenho: quadros por segundo com 150 carros
  await page.click("#t-resumo");
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0, worst = 0, last = performance.now(); const t0 = last;
    function f(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else res({ fps: Math.round(n / ((t - t0) / 1000)), worstFrameMs: Math.round(worst) }); }
    requestAnimationFrame(f);
  }));
  st = await S();
  ok("60 fps com 150 carros", fps.fps >= 55, { ...fps, cars: st.cars.length });

  // noite
  await page.click("#btn-theme"); await wait(400);
  ok("tema noite aplicado", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await shot("desk-night");
  await page.click("#t-estruturas"); await wait(200); await shot("desk-night-estruturas");
  await page.click("#t-resumo");

  // teclado: foco visível no primeiro controle
  await page.keyboard.press("Tab");
  const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  ok("foco por teclado visível", focusOutline !== "none", focusOutline);

  // --------------------------------------------------------------- celular
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("atlas-theme", "light")); await page.reload(); await ready(); await wait(900);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
  ok("sem rolagem horizontal (390px)", noHScroll);
  await shot("mob-day");
  const mn = await visibleNodes();
  await page.mouse.click(mn[0][1], mn[0][2]); await wait(150); await page.mouse.click(mn[mn.length - 1][1], mn[mn.length - 1][2]); await wait(400);
  ok("rota no celular", (await page.evaluate(() => window.__atlas.route && window.__atlas.route.found)));
  await wait(700); await shot("mob-day-busca-anim");
  await page.waitForFunction(() => !window.__atlas.anim || window.__atlas.anim.done, null, { timeout: 10000 });
  await shot("mob-day-rota");
  await page.click("#sheet-handle"); await wait(450);
  ok("gaveta inferior abre", await page.evaluate(() => document.querySelector("#panel").classList.contains("open")));
  await shot("mob-day-gaveta");
  await page.click("#sheet-handle"); await wait(400);
  await page.evaluate(() => localStorage.setItem("atlas-theme", "dark")); await page.reload(); await ready(); await wait(900);
  await shot("mob-night");
  await page.click("#t-chamados"); await wait(450); await shot("mob-night-chamados");
  await page.evaluate(() => localStorage.removeItem("atlas-tour")); await page.reload(); await ready(); await wait(900);
  await shot("mob-night-tour");

  ok("console sem erros nem avisos", report.console.length === 0, report.console.slice(0, 3));
  report.passed = report.checks.filter((c) => c.pass).length;
  report.failed = report.checks.filter((c) => !c.pass).map((c) => c.name);
  return JSON.stringify(report, null, 1);
}
