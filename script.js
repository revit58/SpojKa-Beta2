// script.js - Hlavní logika aplikace SpojKa

// DŮLEŽITÉ: Importy dat musí být na nejvyšší úrovni souboru, mimo DOMContentLoaded nebo jiné funkce.
// Toto je správné místo pro importy.
import { stations } from './data/stations.js';
import { closures } from './data/closures.js';
import { baseConnections } from './data/baseConnections.js';
import { generateBidirectionalConnections } from './utils/connectionGenerator.js';

// Generujeme všechny spoje hned po načtení dat
const allConnections = generateBidirectionalConnections(baseConnections);

// --- Příprava dat pro hledání s přestupy (graf) ---
const adjacencyList = {};

allConnections.forEach(connection => {
    for (let i = 0; i < connection.route.length - 1; i++) {
        const currentStation = connection.route[i].toLowerCase();
        const nextStation = connection.route[i + 1].toLowerCase();

        if (!adjacencyList[currentStation]) {
            adjacencyList[currentStation] = [];
        }
        // Ukládáme i název "fromStation" pro pozdější rekonstrukci cesty, pokud by bylo potřeba rozlišit
        // Pro Dijkstru budeme potřebovat i informaci o předchozím spojení pro výpočet přestupu
        adjacencyList[currentStation].push({ to: nextStation, connection: connection, fromStation: currentStation });
    }
});


// DŮLEŽITÉ: Veškerý kód, který pracuje s HTML elementy, MUSÍ být uvnitř DOMContentLoaded.
document.addEventListener('DOMContentLoaded', () => {

    // --- Získání odkazů na HTML prvky (VŠECHNY ZDE UVNITŘ DOMContentLoaded) ---
    const fromStationInput = document.getElementById('fromStation');
    const viaStationInput = document.getElementById('viaStation');
    const toStationInput = document.getElementById('toStation');
    const searchButton = document.getElementById('searchButton');
    const searchResultsUl = document.getElementById('searchResults');

    const departureStationInput = document.getElementById('departureStation');
    const showDeparturesButton = document.getElementById('showDeparturesButton');
    const departureResultsUl = document.getElementById('departureResults');

    const fromStationSuggestions = document.getElementById('fromStationSuggestions');
    const viaStationSuggestions = document.getElementById('viaStationSuggestions');
    const toStationSuggestions = document.getElementById('toStationSuggestions');
    const departureStationSuggestions = document.getElementById('departureStationSuggestions');

    // Modální okno a jeho prvky - Opraveno pro případ, že element ještě není načten
    const connectionDetailsModal = document.getElementById('connectionDetailsModal');
    const closeButton = connectionDetailsModal ? connectionDetailsModal.querySelector('.close-button') : null;
    const modalConnectionName = document.getElementById('modalConnectionName');
    const modalConnectionDetails = document.getElementById('modalConnectionDetails');


    // --- Funkce pro zobrazení detailů spoje v modálním okně ---
    function showConnectionDetails(connectionId) {
        const connection = allConnections.find(c => c.id === connectionId);

        if (connection && modalConnectionName && modalConnectionDetails && connectionDetailsModal) {
            modalConnectionName.textContent = `${connection.name} (${connection.type}, ${connection.carrier})`;
            modalConnectionDetails.innerHTML = `
                <h3>Trasa spoje:</h3>
                <ul>
                    ${connection.route.map((station, index) => `<li><span class="detail-icon"><img src="./icons/dot.png" alt="Zastávka"></span> ${station}</li>`).join('')}
                </ul>
                <p><strong>Typ spoje:</strong> ${connection.type}</p>
                <p><strong>Dopravce:</strong> ${connection.carrier}</p>
                ${connection.propulsionType ? `<p><strong>Typ pohonu:</strong> ${connection.propulsionType === 'electric' ? 'Elektrický' : 'Motorový'}</p>` : ''}
                ${connection.notes ? `<p><strong>Poznámky:</strong> ${connection.notes}</p>` : ''}
            `;
            connectionDetailsModal.style.display = 'flex';
        } else {
            console.error('Chyba: Nepodařilo se najít detaily spoje nebo modální elementy.');
        }
    }

    // --- Funkce pro zavření modálního okna ---
    function closeConnectionDetailsModal() {
        if (connectionDetailsModal) {
            connectionDetailsModal.style.display = 'none';
            if (modalConnectionDetails) {
                modalConnectionDetails.innerHTML = '';
            }
        }
    }

    // --- Event Listeners pro modální okno ---
    if (closeButton) {
        closeButton.addEventListener('click', closeConnectionDetailsModal);
    }
    if (connectionDetailsModal) {
        window.addEventListener('click', (event) => {
            if (event.target === connectionDetailsModal) {
                closeConnectionDetailsModal();
            }
        });
    }


    // --- Funkce pro získání názvu ikony podle typu spoje ---
    function getIconFileName(connectionType) {
        const normalizedType = connectionType.toLowerCase();

        switch(normalizedType) {
            case 'os': // Osobní vlak
            case 'r':  // Rychlík
            case 'ex': // Expres
            case 'ec': // EuroCity
            case 'ic': // InterCity
                return 'train';
            case 'autobus': // Autobus
                return 'bus';
            case 'tramvaj': // TRAMVAJ - nyní rozpozná české slovo
                return 'tram'; // Název souboru ikony
            case 'trolejbus': // Trolejbus
                return 'trolleybus';
            case 'loď': // Loď
                return 'ship';
            case 'letadlo': // Letadlo
                return 'plane';
            default:
                return 'train'; // Výchozí ikona pro neznámé typy
        }
    }


    // --- Nyní přichází Dijkstrův algoritmus ---

    // Pomocná funkce pro výpočet váhy hrany
    // Můžete si pohrát s těmito hodnotami
    const SEGMENT_COST = 1;      // Cena za každý projetý segment (stanici)
    const TRANSFER_COST = 50000;   // Cena za přestup (penalty za přestup)
    // Vyšší TRANSFER_COST znamená, že algoritmus se více snaží vyhýbat přestupům.
    // Problém s Sebečice - Branice je 3 přestupy, takže 3 * 500 = 1500 + segmenty.
    // Cesta přes Žichovice by mohla mít méně přestupů.

    function getEdgeWeight(lastConnectionId, newConnectionId) {
        if (lastConnectionId === null) { // První segment cesty
            return SEGMENT_COST;
        }
        if (lastConnectionId !== newConnectionId) { // Změna spoje = přestup
            return SEGMENT_COST + TRANSFER_COST;
        }
        return SEGMENT_COST; // Stejný spoj, jen další segment
    }


    /**
     * Nalezne nejlepší cestu (s nejnižší celkovou váhou) pomocí Dijkstrova algoritmu.
     * @param {string} startStation - Výchozí stanice.
     * @param {string} endStation - Cílová stanice.
     * @param {number} maxTransfers - Maximální povolený počet přestupů.
     * @returns {Array<Object>} Pole nalezených cest, každá s { path, connections, transfers, cost }.
     */
    function findPathsDijkstra(startStation, endStation, maxTransfers = 7) {
        console.log(`Zahajuji Dijkstrovo hledání z "${startStation}" do "${endStation}" s max. ${maxTransfers} přestupy.`);
        const normalizedStart = startStation.toLowerCase();
        const normalizedEnd = endStation.toLowerCase();

        // stores the shortest distance from start to station
        const distances = {};
        // stores the path (array of station names) to reach the station with the shortest distance
        const paths = {};
        // stores the array of connections used to reach the station with the shortest distance
        const connections = {};
        // stores the number of transfers to reach the station with the shortest distance
        const transfers = {};
        // stores the last connection ID used to reach the station
        const lastConnectionIds = {};

        // Priority Queue: [cost, station, lastConnectionId, currentTransfers, currentPathStations, currentPathConnections]
        // For simplicity, we'll use a plain array and sort it. For large graphs, a MinHeap is much more efficient.
        const priorityQueue = [];

        // Initialize all distances to Infinity, and paths/connections as empty
        for (const station of stations) {
            const lowerCaseStation = station.toLowerCase();
            distances[lowerCaseStation] = Infinity;
            paths[lowerCaseStation] = [];
            connections[lowerCaseStation] = [];
            transfers[lowerCaseStation] = Infinity;
            lastConnectionIds[lowerCaseStation] = null;
        }

        // Set initial values for the start station
        distances[normalizedStart] = 0;
        paths[normalizedStart] = [startStation];
        connections[normalizedStart] = [];
        transfers[normalizedStart] = 0;
        lastConnectionIds[normalizedStart] = null;

        // Add the start station to the priority queue
        priorityQueue.push([0, normalizedStart, null, 0, [startStation], []]);

        let iterationCount = 0;
        const MAX_DIJKSTRA_ITERATIONS = 500000; // Zvýšeno pro Dijkstru, protože prohledává efektivněji

        const finalFoundPaths = []; // To store the single best path found

        while (priorityQueue.length > 0 && iterationCount < MAX_DIJKSTRA_ITERATIONS) {
            iterationCount++;

            // Sort the queue to always process the lowest cost path (simulates a min-heap)
            priorityQueue.sort((a, b) => a[0] - b[0]);
            const [currentCost, currentStation, currentLastConnectionId, currentTransfersCount, currentPathStations, currentPathConnections] = priorityQueue.shift();

            // If we already found a shorter path to this station, skip
            if (currentCost > distances[currentStation]) {
                continue;
            }

            // If we reached the end station, we found an optimal path (based on weights)
            // For Dijkstra, the first time we extract the end node from the priority queue,
            // we've found the shortest path.
            if (currentStation === normalizedEnd) {
                finalFoundPaths.push({
                    path: currentPathStations,
                    connections: currentPathConnections,
                    transfers: currentTransfersCount,
                    cost: currentCost
                });
                console.log(`  Nalezena optimální cesta do cíle (${normalizedEnd}): ${currentPathStations.join(' -> ')} s ${currentTransfersCount} přestupy. Cena: ${currentCost}`);
                // Vracíme pouze první nalezenou nejlepší cestu.
                // Pokud byste chtěli více (např. top 3), logika by se musela upravit.
                return finalFoundPaths;
            }

            const neighborsData = adjacencyList[currentStation] || [];
            for (const neighborInfo of neighborsData) {
                const neighbor = neighborInfo.to;
                const connectionUsed = neighborInfo.connection;

                // Kontrola výluk
                const isSegmentClosed = closures.some(closure => {
                    const closureFrom = closure.from.toLowerCase();
                    const closureTo = closure.to.toLowerCase();
                    return (currentStation === closureFrom && neighbor === closureTo) ||
                           (currentStation === closureTo && neighbor === closureFrom);
                });

                if (isSegmentClosed) {
                    continue;
                }

                const newConnectionId = connectionUsed.id;
                const edgeWeight = getEdgeWeight(currentLastConnectionId, newConnectionId);

                const newTransfersCount = currentTransfersCount + (currentLastConnectionId !== null && newConnectionId !== currentLastConnectionId ? 1 : 0);

                // Kontrola maximálního počtu přestupů
                if (newTransfersCount > maxTransfers) {
                    continue;
                }

                const newCost = currentCost + edgeWeight;

                // Pokud jsme našli kratší cestu (nebo cestu se stejnou cenou, ale méně přestupy)
                // U Dijkstry porovnáváme jen celkovou cenu. Optimalizace na přestupy je již v ceně.
                if (newCost < distances[neighbor]) {
                    distances[neighbor] = newCost;
                    paths[neighbor] = [...currentPathStations, (stations.find(s => s.toLowerCase() === neighbor) || neighbor)];
                    connections[neighbor] = [...currentPathConnections, connectionUsed];
                    transfers[neighbor] = newTransfersCount;
                    lastConnectionIds[neighbor] = newConnectionId;

                    priorityQueue.push([
                        newCost,
                        neighbor,
                        newConnectionId,
                        newTransfersCount,
                        paths[neighbor],         // Předáváme aktualizovanou cestu stanic
                        connections[neighbor]     // Předáváme aktualizované spoje
                    ]);
                }
            }
        }

        console.log(`Hledání dokončeno. Celkem iterací: ${iterationCount}.`);
        if (iterationCount >= MAX_DIJKSTRA_ITERATIONS) {
            console.warn(`Upozornění: Algoritmus dosáhl limitu iterací (${MAX_DIJKSTRA_ITERATIONS}). Možná nebyly prohledány všechny cesty.`);
        }

        return finalFoundPaths; // Vrací nalezené cesty (pokud jich najde víc)
    }


    // --- Funkce pro vyhledávání spojení (nyní volá Dijkstru) ---
    function searchConnections() {
        if (!searchResultsUl || !fromStationInput || !toStationInput || !viaStationInput) {
            console.error('Chyba: HTML elementy pro vyhledávání nejsou plně načteny.');
            return;
        }

        searchResultsUl.innerHTML = ''; // Vyčistíme výsledky před novým hledáním

        const from = fromStationInput.value.trim();
        const via = viaStationInput.value.trim();
        const to = toStationInput.value.trim();

        if (!from || !to) {
            alert("Prosím zadejte výchozí a cílovou stanici.");
            return;
        }

        // Validace existence stanic
        const lowerCaseStations = stations.map(s => s.toLowerCase());
        if (!lowerCaseStations.includes(from.toLowerCase())) {
            alert(`Výchozí stanice "${from}" neexistuje v našich datech. Zvolte prosím z nabídky.`);
            return;
        }
        if (!lowerCaseStations.includes(to.toLowerCase())) {
            alert(`Cílová stanice "${to}" neexistuje v našich datech. Zvolte prosím z nabídky.`);
            return;
        }
        if (via && !lowerCaseStations.includes(via.toLowerCase())) {
            alert(`Stanice "Přes" "${via}" neexistuje v našich datech. Zvolte prosím z nabídky.`);
            return;
        }

        const MAX_TRANSFERS = 7; // Maximální povolený počet přestupů
        const MAX_RESULTS_TO_DISPLAY = 8; // Omezení počtu zobrazených výsledků

        // *** ZDE JE KLÍČOVÁ ZMĚNA: VOLÁME findPathsDijkstra místo findPathsBFS ***
        let foundPaths = findPathsDijkstra(from, to, MAX_TRANSFERS);

        // Nyní již foundPaths obsahuje přímo optimální cestu/cesty, není třeba tak složité řazení.
        // Filtrace podle "Přes" stanice stále zůstává relevantní.
        const filteredPaths = via
            ? foundPaths.filter(pathInfo => {
                const pathLower = pathInfo.path.map(s => s.toLowerCase());
                const fromIdx = pathLower.indexOf(from.toLowerCase());
                const viaIdx = pathLower.indexOf(via.toLowerCase());
                const toIdx = pathLower.indexOf(to.toLowerCase());

                // Musí obsahovat všechny tři stanice a být ve správném pořadí
                return fromIdx !== -1 && viaIdx !== -1 && toIdx !== -1 &&
                       fromIdx < viaIdx && viaIdx < toIdx;
            })
            : foundPaths;

        if (filteredPaths.length > 0) {
            // Dijkstrův algoritmus již našel nejlepší cestu podle vah, takže není nutné složité řazení.
            // Můžeme jen omezit počet zobrazených výsledků.
            const finalPathsToDisplay = filteredPaths.slice(0, MAX_RESULTS_TO_DISPLAY);

            finalPathsToDisplay.forEach(pathInfo => {
                const li = document.createElement('li');
                const routeStations = pathInfo.path.join(' &rarr; ');
                const actualTransfers = pathInfo.transfers; // Používáme nově vypočítané přestupy

                let connectionDetails = '';
                if (actualTransfers <= 0) { // Přímé spojení (0 přestupů)
                    const conn = pathInfo.connections[0];
                    const connectionTypeClass = `connection-type-${conn.type.toLowerCase()}`;
                    const iconFileName = getIconFileName(conn.type);

                    const iconHtml = `<span class="result-icon ${connectionTypeClass}"><img src="./icons/${iconFileName}.png" alt="${conn.type} ikona"></span>`;

                    connectionDetails = `
                        ${iconHtml}
                        <div class="result-content">
                            <strong class="clickable-connection-name" data-connection-id="${conn.id}">Přímé spojení: ${conn.name}</strong> (${conn.type}, ${conn.carrier})
                            <p>Celková trasa: ${routeStations}</p>
                        </div>
                    `;
                } else { // Spojení s přestupy
                    let segmentsHtml = [];
                    let lastConnectionId = null;

                    const transferIconHtml = `<span class="result-icon transfer-icon"><img src="./icons/transfer.png" alt="Přestup"></span>`;

                    // Rekonstruujeme segmenty spojení, aby se zobrazil každý přestup
                    let currentSegmentConnections = [];
                    let previousConnection = null;

                    pathInfo.connections.forEach((conn, index) => {
                        if (previousConnection === null || conn.id !== previousConnection.id) {
                            // Začátek nového segmentu nebo přestup
                            if (currentSegmentConnections.length > 0) {
                                // Dokončit předchozí segment
                                const segmentConn = currentSegmentConnections[0];
                                const segmentTypeClass = `connection-type-${segmentConn.type.toLowerCase()}`;
                                const segmentIconFileName = getIconFileName(segmentConn.type);
                                segmentsHtml.push(`<li><span class="connection-segment-icon ${segmentTypeClass}"><img src="./icons/${segmentIconFileName}.png" alt="${segmentConn.type} ikona"></span> ${segmentConn.type} <strong class="clickable-connection-name" data-connection-id="${segmentConn.id}">${segmentConn.name}</strong> (${segmentConn.carrier})</li>`);
                            }
                            currentSegmentConnections = [conn];
                        } else {
                            // Pokračování ve stejném segmentu
                            currentSegmentConnections.push(conn);
                        }
                        previousConnection = conn;
                    });
                    // Přidat poslední segment
                    if (currentSegmentConnections.length > 0) {
                        const segmentConn = currentSegmentConnections[0];
                        const segmentTypeClass = `connection-type-${segmentConn.type.toLowerCase()}`;
                        const segmentIconFileName = getIconFileName(segmentConn.type);
                        segmentsHtml.push(`<li><span class="connection-segment-icon ${segmentTypeClass}"><img src="./icons/${segmentIconFileName}.png" alt="${segmentConn.type} ikona"></span> ${segmentConn.type} <strong class="clickable-connection-name" data-connection-id="${segmentConn.id}">${segmentConn.name}</strong> (${segmentConn.carrier})</li>`);
                    }


                    // Lokalizace textu pro přestupy
                    let prestupText;
                    if (actualTransfers === 0) {
                        prestupText = 'přímé spojení';
                    } else if (actualTransfers === 1) {
                        prestupText = '1 přestup';
                    } else if (actualTransfers >= 2 && actualTransfers <= 4) {
                        prestupText = `${actualTransfers} přestupy`;
                    } else {
                        prestupText = `${actualTransfers} přestupů`;
                    }

                    connectionDetails = `
                        ${transferIconHtml}
                        <div class="result-content">
                            <strong>Nalezeno spojení (${prestupText}):</strong>
                            <ul class="connection-segments">
                                ${segmentsHtml.join('')}
                            </ul>
                            <p>Celková trasa: ${routeStations}</p>
                        </div>
                    `;
                }

                li.innerHTML = connectionDetails;
                searchResultsUl.appendChild(li);
            });

            // Přidání event listenerů pro klikatelné názvy spojů
            searchResultsUl.querySelectorAll('.clickable-connection-name').forEach(nameElement => {
                nameElement.addEventListener('click', (event) => {
                    const connectionId = event.target.dataset.connectionId;
                    showConnectionDetails(connectionId);
                });
            });

        } else {
            const li = document.createElement('li');
            li.textContent = `Žádné spojení nebylo nalezeno z "${from}" do "${to}" ${via ? `přes "${via}"` : ''} s maximálně ${MAX_TRANSFERS} přestupy.`;
            li.classList.add('no-results');
            searchResultsUl.appendChild(li);
        }
    }

    // --- Funkce pro zobrazení odjezdů ze stanice ---
    function showDepartures() {
        if (!departureResultsUl || !departureStationInput) {
            console.error('Chyba: HTML elementy pro odjezdy nejsou plně načteny.');
            return;
        }

        departureResultsUl.innerHTML = ''; // Vyčistíme výsledky

        const stationName = departureStationInput.value.trim().toLowerCase();

        if (!stationName) {
            alert("Prosím zadejte název stanice pro zobrazení odjezdů.");
            return;
        }

        const exactStationMatch = stations.find(s => s.toLowerCase() === stationName);
        if (!exactStationMatch) {
            const li = document.createElement('li');
            li.textContent = `Stanice "${stationName}" neexistuje. Zvolte prosím z nabídky.`;
            li.classList.add('no-results');
            departureResultsUl.appendChild(li);
            return;
        }

        const departingConnections = allConnections.filter(connection => {
            const route = connection.route.map(s => s.toLowerCase());
            const stationIndex = route.indexOf(stationName);

            // Spoj musí začínat v dané stanici nebo jí procházet a mít další zastávku
            if (stationIndex === -1 || stationIndex >= route.length - 1) {
                return false;
            }

            const nextStop = route[stationIndex + 1];
            // Kontrola výluky pro daný segment
            const isSegmentClosed = closures.some(closure => {
                const closureFrom = closure.from.toLowerCase();
                const closureTo = closure.to.toLowerCase();
                return (stationName === closureFrom && nextStop === closureTo) ||
                       (stationName === closureTo && nextStop === closureFrom);
            });

            return !isSegmentClosed;
        });

        if (departingConnections.length > 0) {
            departingConnections.sort((a, b) => a.name.localeCompare(b.name)); // Seřadíme podle názvu spoje

            departingConnections.forEach(connection => {
                const li = document.createElement('li');
                const stationIndex = connection.route.map(s => s.toLowerCase()).indexOf(stationName);
                const nextStop = connection.route[stationIndex + 1];
                const finalDestination = connection.route[connection.route.length - 1]; // Poslední zastávka je konečná destinace

                const iconFileNameDeparture = getIconFileName(connection.type);

                const iconHtml = `<span class="result-icon connection-type-${connection.type.toLowerCase()}"><img src="./icons/${iconFileNameDeparture}.png" alt="${connection.type} ikona"></span>`;

                li.innerHTML = `
                    ${iconHtml}
                    <div class="result-content">
                        <strong class="clickable-connection-name" data-connection-id="${connection.id}">${connection.name}</strong> (${connection.type}, ${connection.carrier})<br>
                        <p>Směr: ${connection.route[stationIndex]} &rarr; ${finalDestination} (Další zastávka: ${nextStop})</p>
                    </div>
                `;
                departureResultsUl.appendChild(li);
            });

            // Přidání event listenerů pro klikatelné názvy spojů v odjezdech
            departureResultsUl.querySelectorAll('.clickable-connection-name').forEach(nameElement => {
                nameElement.addEventListener('click', (event) => {
                    const connectionId = event.target.dataset.connectionId;
                    showConnectionDetails(connectionId);
                });
            });

        } else {
            const li = document.createElement('li');
            li.textContent = `Ze stanice "${exactStationMatch}" nebyly nalezeny žádné odjezdy nebo je úsek ve výluce.`;
            li.classList.add('no-results');
            departureResultsUl.appendChild(li);
        }
    }

    // --- Autocomplete logika ---
    let activeSuggestionIndex = -1; // Index pro navigaci v našeptávači pomocí šipek

    function setupAutocomplete(inputElement, suggestionsContainer) {
        if (!inputElement || !suggestionsContainer) {
            console.warn('Autocomplete setup failed: Input or suggestions container not found.');
            return;
        }

        inputElement.addEventListener('input', () => {
            const inputValue = inputElement.value.trim();
            suggestionsContainer.innerHTML = ''; // Vyčistíme předchozí návrhy
            activeSuggestionIndex = -1; // Resetujeme index

            if (inputValue.length < 1) { // Nechceme našeptávat pro prázdný vstup
                suggestionsContainer.classList.remove('active');
                return;
            }

            // Filtrujeme stanice, které obsahují zadaný text (case-insensitive)
            const filteredStations = stations.filter(station =>
                station.toLowerCase().includes(inputValue.toLowerCase())
            ).slice(0, 10); // Omezení na 10 nejrelevantnějších návrhů

            if (filteredStations.length > 0) {
                filteredStations.forEach((station, index) => {
                    const suggestionItem = document.createElement('div');
                    suggestionItem.classList.add('suggestion-item');
                    // Zvýraznění shodné části textu
                    const regex = new RegExp(inputValue, 'gi');
                    suggestionItem.innerHTML = station.replace(regex, '<strong>$&</strong>');
                    suggestionItem.dataset.value = station; // Uložíme celý název stanice pro snadné nastavení

                    suggestionItem.addEventListener('click', () => {
                        inputElement.value = station; // Nastavíme hodnotu inputu po kliknutí
                        suggestionsContainer.classList.remove('active'); // Zavřeme našeptávač
                        inputElement.focus(); // Vrátíme focus na input
                    });
                    suggestionsContainer.appendChild(suggestionItem);
                });
                suggestionsContainer.classList.add('active'); // Zobrazíme našeptávač
            } else {
                suggestionsContainer.classList.remove('active'); // Skryjeme, pokud nejsou žádné návrhy
            }
        });

        inputElement.addEventListener('keydown', (e) => {
            const items = suggestionsContainer.querySelectorAll('.suggestion-item');
            if (items.length === 0) return; // Žádné návrhy, nic se neděje

            if (e.key === 'ArrowDown') {
                e.preventDefault(); // Zabrání posouvání stránky
                if (activeSuggestionIndex < items.length - 1) {
                    activeSuggestionIndex++;
                } else {
                    activeSuggestionIndex = 0; // Cyklické procházení
                }
                highlightSuggestion(items, activeSuggestionIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault(); // Zabrání posouvání stránky
                if (activeSuggestionIndex > 0) {
                    activeSuggestionIndex--;
                } else {
                    activeSuggestionIndex = items.length - 1; // Cyklické procházení
                }
                highlightSuggestion(items, activeSuggestionIndex);
            } else if (e.key === 'Enter') {
                if (activeSuggestionIndex > -1 && items[activeSuggestionIndex]) {
                    // Pokud je vybrán návrh, nastavíme ho a spustíme vyhledávání/odjezdy
                    inputElement.value = items[activeSuggestionIndex].dataset.value;
                    suggestionsContainer.classList.remove('active');
                    activeSuggestionIndex = -1;
                    if (inputElement.id === 'fromStation' || inputElement.id === 'viaStation' || inputElement.id === 'toStation') {
                        searchConnections();
                    } else if (inputElement.id === 'departureStation') {
                        showDepartures();
                    }
                } else {
                    // Pokud je Enter stisknut bez výběru návrhu (jen po dopsání)
                    if (inputElement.id === 'fromStation' || inputElement.id === 'viaStation' || inputElement.id === 'toStation') {
                        searchConnections();
                    } else if (inputElement.id === 'departureStation') {
                        showDepartures();
                    }
                }
                suggestionsContainer.classList.remove('active'); // Zavřeme našeptávač po Enteru
            } else if (e.key === 'Escape') {
                suggestionsContainer.classList.remove('active'); // Skryjeme našeptávač na Escape
                activeSuggestionIndex = -1;
            }
        });

        // Skrytí našeptávače při kliknutí mimo input a našeptávač
        document.addEventListener('click', (e) => {
            if (!inputElement.parentNode.contains(e.target)) {
                suggestionsContainer.classList.remove('active');
                activeSuggestionIndex = -1;
            }
        });
    }

    function highlightSuggestion(items, index) {
        items.forEach((item, i) => {
            item.classList.remove('highlighted');
            if (i === index) {
                item.classList.add('highlighted');
                // Posuneme scroll, aby byl označený prvek vidět
                item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });
    }

    // --- Aplikace autocomplete na všechny relevantní inputy ---
    setupAutocomplete(fromStationInput, fromStationSuggestions);
    setupAutocomplete(viaStationInput, viaStationSuggestions);
    setupAutocomplete(toStationInput, toStationSuggestions);
    setupAutocomplete(departureStationInput, departureStationSuggestions);


    // --- Přidání posluchačů událostí (event listeners) na tlačítka ---
    if (searchButton) {
        searchButton.addEventListener('click', searchConnections);
    }
    if (showDeparturesButton) {
        showDeparturesButton.addEventListener('click', showDepartures);
    }


    // Kontrola načtených dat v konzoli prohlížeče (pro ladění)
    console.log("Načtené stanice (z modulu):", stations);
    console.log("Načtené výluky (z modulu):", closures);
    console.log("Vygenerované VŠECHNY spoje (včetně zpátečních):", allConnections);
    console.log("Adjacency List (graf pro Dijkstru):", adjacencyList);

}); // Konec DOMContentLoaded