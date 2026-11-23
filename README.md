# ATLAS: uma cidade simulada movida por estruturas de dados

Todas as estruturas foram **implementadas do zero**, em duas versões que dão o mesmo resultado:
`ds_lib/` + `city/` em Python (referência) e `web/engine/` em JavaScript (ES modules, sem dependências),
que roda no navegador dentro de um Web Worker. O front-end (`web/`) é um site estático: não precisa de servidor.

## Como rodar

```bash
# site interativo, sem servidor Python: sirva a pasta web/ com qualquer servidor estático
cd web && python -m http.server 8765      # abre em http://127.0.0.1:8765

./run_tests.sh                  # 121 testes Python + 20 testes JS (estruturas e paridade com o Python)
python3 tools/build_site.py     # gera dist/ (página com o CSS embutido)
python3 run.py                  # versão antiga com servidor Python + API (continua funcionando)
python3 benchmarks.py --quick   # relatório de benchmarks em Python (reports/)
```

Requer Python 3.9+ e Node 18+ para os testes JS. Nenhuma dependência externa.
Para publicar em GitHub Pages, Netlify ou similar, basta subir a pasta `web/`.

### Arquitetura do site
- `web/engine/`: porte das estruturas e da simulação (`city.js` espelha `city/simulation.py` linha a linha).
  `pycompat.js` reproduz bit a bit o `random.Random` do Python (Mersenne Twister), o `math.hypot` do CPython
  e o `round()` com empate para o par; `hashtable.js` usa o mesmo hash de 64 bits (BigInt). Por isso a mesma seed
  gera o mesmo mapa, as mesmas rotas e o mesmo estado.
- `web/engine/host.js`: substitui o servidor HTTP. Cada antiga rota `/api/*` virou um método chamado por mensagem.
- `web/worker.js`: roda o motor num Web Worker (a simulação não disputa a thread do desenho). Se o navegador
  recusar workers de módulo, o mesmo motor roda na página. O benchmark usa um segundo worker.
- `web/app.js`: desenho em 4 camadas de canvas. Quarteirões, ruas, rótulos e hospitais ficam em camadas
  estáticas e só são redesenhados ao mudar zoom, pan, tema ou malha; carros, trânsito e pinos são redesenhados a cada quadro.

### Testes de paridade
`tests_js/gen_fixtures.py` roda 5 cidades no Python (seeds 42, 1, 7, 3 e 2^40+12345, até 16x10 e 150 carros, uma delas
com o trânsito desligado) com um roteiro de cerca de 100 ações cada: 31 rotas, 16 buscas (com erros de digitação), 20 consultas de moradores,
3 chamados, vias fechadas, desfazer/refazer, um cruzamento isolado, trânsito ligado e desligado e 460 ticks. `tests_js/parity.test.mjs` repete
o roteiro no motor JS e compara cada saída campo a campo, incluindo o `state_json` completo. Também compara
sequências do gerador aleatório, 4.000 valores de `hypot`, 2.000 de `round` e o hash de 64 bits.
`tests_js/e2e.playwright.js` testa o site no navegador (rota, chamado, via fechada, desfazer, busca, morador,
benchmark, temas, celular, console limpo e quadros por segundo).

### Como usar a interface
- **Buscar uma rua** (canto superior esquerdo): autocompletar com Trie; se errar a digitação, sugere pelo Levenshtein.
- **Rota**: clique em dois cruzamentos. Uma animação mostra a busca: anéis cinza são os cruzamentos que o Dijkstra fecha (cresce em círculo) e pontos azuis os que o A* expande (vai direto ao destino). Depois aparecem tempo, distância e a rota. "Ver a busca de novo" repete; com movimento reduzido, mostra o resultado final parado.
- **Chamado**: escolha a gravidade e clique no mapa. O chamado entra numa heap (mais grave primeiro), a quadtree escolhe as ambulâncias candidatas, o Dijkstra decide a mais rápida e o KD-Tree acha o hospital.
- **Fechar via**: clique numa rua. O Union-Find recalcula as ilhas e as rotas se adaptam. Desfazer/refazer usa uma pilha.
- **Modo tutor** (ícone de capelo): explica qual estrutura entrou em ação a cada ação.
- **Rotas evitam trânsito** (em Camadas, ligado por padrão): ruas lentas custam 1,6× e intensas 2,5× no Dijkstra. O cartão da rota mostra o caminho que o trânsito fez evitar (tracejado cinza) e quanto tempo ele levaria; a rota na tela se recalcula quando o trânsito muda.
- **Camadas**: trânsito, quadtree, rede mínima (Kruskal) e ilhas.
- **Teclado**: com o mapa em foco, setas movem, `+`/`−` aproximam, `0` enquadra e `Enter` clica no centro (mira).

## Estruturas e onde são usadas

| Estrutura | Arquivo | Uso na cidade | Complexidade |
|---|---|---|---|
| Lista duplamente encadeada | `linked_list.py` | linha do tempo; base do LRU | push/pop/remove/mover: O(1) |
| Vetor dinâmico | `stack_queue.py` | base da pilha | append O(1) amortizado |
| Pilha | `stack_queue.py` | desfazer/refazer ações | O(1) |
| Deque / fila circular | `stack_queue.py` | fila da BFS e da ordenação topológica | O(1) |
| Tabela hash (encadeamento) | `hashtable.py` | índice do LRU, chamados, nomes de ruas | médio O(1), pior O(n) |
| Hash com endereçamento aberto (linear/quadrático/duplo) | `hashtable.py` | comparação nos benchmarks | médio O(1) |
| Heap binária | `heap.py` | fila de chamados por gravidade; Dijkstra; Kruskal; top-K | push/pop O(log n); heapify O(n) |
| Fila de prioridade indexada | `heap.py` | prioridade mutável (update/remove) | O(log n) |
| Bloom Filter | `probabilistic.py` | "esse morador existe?" antes da AVL | O(k), sem falso negativo |
| Count-Min Sketch | `probabilistic.py` | ruas mais usadas em memória fixa | O(profundidade) |
| LRU Cache | `lru.py` | cache de rotas (chave inclui a versão da malha) | get/put O(1) |
| AVL | `avl.py` | cadastro de moradores, consulta por faixa de ID | O(log n) pior caso |
| Skip List | `skiplist.py` | alternativa probabilística à AVL (benchmark) | O(log n) esperado |
| Segment Tree | `range_queries.py` | vazão e pico de tráfego por janela | update/query O(log n) |
| Fenwick Tree | `range_queries.py` | total de atendimentos | O(log n) |
| Sparse Table | `range_queries.py` | mín/máx estático | build O(n log n), query O(1) |
| Trie | `trie.py` | autocompletar nomes de ruas (top-K por peso) | inserir/buscar O(L) |
| Levenshtein (prog. dinâmica) | `strings.py` | "você quis dizer…?" | O(mn) |
| KMP | `strings.py` | busca de padrão em texto | O(n+m) |
| Huffman | `huffman.py` | compressão do log de eventos | O(k log k) |
| Grafo (lista de adjacência) | `graph.py` | malha viária | espaço O(V+E) |
| Dijkstra / A* | `graph.py` | rotas (A* usa heurística euclidiana) | O((V+E) log V) |
| Bellman-Ford / Floyd-Warshall | `graph.py` | pesos negativos / todos os pares | O(VE) / O(V³) |
| Union-Find | `graph.py` | ilhas quando uma via fecha; Kruskal | O(α(n)) amortizado |
| Kruskal | `graph.py` | rede mínima (MST) | O(E log E) |
| BFS / DFS / Topológica / Tarjan (SCC) | `graph.py` | percursos, dependências, componentes | O(V+E) |
| Quadtree | `spatial.py` | ambulâncias livres mais próximas; densidade de carros | médio O(log n) |
| KD-Tree | `spatial.py` | hospital mais próximo | médio O(log n) |

Detalhes de projeto:
- Hash com capacidade potência de 2 e índice `hash & (cap-1)`; função de hash própria (FNV-1a + mixer de 64 bits).
- Endereçamento aberto usa lápides (tombstones) e rehash que as limpa; passo ímpar no hash duplo garante cobrir a tabela.
- O cache de rotas usa `(origem, destino, versão_da_malha)` como chave: fechar uma via sobe a versão e invalida rotas antigas sem varrer o cache.
- Tarjan é iterativo (testado com cadeia de 20 mil nós, sem estourar a recursão).
- Os filhos de cada nó da Trie usam o `dict` do Python (escolha deliberada de memória/velocidade); todas as outras estruturas não usam contêineres prontos para a lógica principal.

## Como a cidade funciona

1. **Mapa:** grade com coordenadas perturbadas; um Kruskal aleatório garante conectividade e cerca de 12% das ruas extras são removidas.
2. **Carros:** fazem o trajeto entre casa e trabalho (rotas se repetem, então o LRU tem acertos). Ao chegar num cruzamento com a malha alterada, recalculam a rota.
3. **Chamados:** entram numa **heap** (gravidade desc, depois mais antigo). A cada tick a **quadtree** das ambulâncias livres sugere as 3 mais próximas e o **Dijkstra** escolhe a de menor custo real. Depois da cena, o **KD-Tree** acha o hospital.
4. **Fechar uma via** (clique na rua): o grafo perde a aresta, o **Union-Find** recalcula as ilhas, a versão sobe e a ação vai para a **pilha** de desfazer.
5. **Trânsito nas rotas:** a cada 10 ticks o motor mede a ocupação média de cada rua (carros por 100 unidades) e a classifica em livre, lenta (≥ 2,3) ou intensa (≥ 3,2). O peso da rua no grafo vira `peso0 × 1 / 1,6 / 2,5`. Se algum nível mudou, a versão da malha sobe: o cache LRU deixa de usar rotas antigas e carros e ambulâncias recalculam no próximo cruzamento. Uma cópia do grafo sem trânsito (`g0`) responde "qual seria o caminho sem trânsito" para comparar. O custo disso: com a malha mudando a cada 10 ticks, o cache LRU acerta bem menos (cerca de 3%, contra 18% sem trânsito). Em troca, as ruas intensas caem de cerca de 4% para 1,6%, porque o trânsito se espalha.
6. **Painéis:** heap desenhada como árvore, lista do LRU, quadtree sobreposta, MST, ilhas, ruas mais usadas, estatísticas de cada estrutura, e um "modo tutor" que explica o que acabou de acontecer.

### API

`GET /api/map` · `/api/state` · `/api/route?src=&dst=` · `/api/autocomplete?prefix=` · `/api/resident?id=` · `/api/residents?lo=&hi=` · `/api/benchmark?quick=1`
`POST /api/emergency {node,severity}` · `/api/close {u,v}` · `/api/open {u,v}` · `/api/undo` · `/api/redo` · `/api/pause {paused}`

## Testes (121 Python + 20 JS + teste no navegador)

Cada estrutura é verificada contra a biblioteca padrão ou força bruta, com operações aleatórias de semente fixa:
`heapq`, `dict`, `OrderedDict`, `collections.deque`, `sorted`/`bisect`, Floyd-Warshall (para Dijkstra), Bellman-Ford, busca de todas as árvores geradoras mínimas por força bruta, alcançabilidade mútua (para Tarjan), vizinho mais próximo por força bruta, DP completa (para Levenshtein) e busca ingênua (para KMP).
Também testam invariantes (AVL balanceada, heap válida, Huffman livre de prefixo), casos limites (heap vazia, pontos duplicados na quadtree, grafo desconexo, ciclo negativo) e a simulação/servidor (determinismo por semente, nenhum chamado perdido, ordem de atendimento por gravidade, rotas que evitam vias fechadas, path traversal bloqueado, requisições concorrentes).

## Benchmarks

`reports/report.md` traz tabelas e gráficos log-log. As estruturas são Python puro, então `dict` e `heapq` (em C) vencem em tempo absoluto; o que o relatório mostra é a **forma da curva** (Trie vs varredura linear, A* vs Dijkstra, AVL com altura dentro do limite 1,44·log₂n, etc.). Para tamanhos maiores: `python3 benchmarks.py --sizes 1000 10000 100000`.

## Limitações conhecidas

- No JS, o hash de 64 bits usa BigInt para bater com o Python; é mais lento que aritmética de 32 bits, mas o tick
  de 150 carros custa cerca de 0,3 ms. As colunas do Count-Min Sketch são memorizadas por aresta (não muda o resultado).
- Os tempos do benchmark no navegador variam com o aparelho e com o JIT; os tamanhos vão até 8.000 para não pesar no celular.
- Os filhos de cada nó da Trie usam `Map` no JS (o Python usa `dict`), mantendo a mesma ordem de inserção.
- B-Tree, Fibonacci Heap, Suffix Array, estruturas persistentes e Consistent Hashing ficaram fora do escopo.
- O desenho do mapa (quarteirões, prédios, parques) é decorativo e não faz parte da paridade com o Python.
