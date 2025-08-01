// utils/connectionGenerator.js

// Funkce pro generování obousměrných spojů
export function generateBidirectionalConnections(baseConnections) {
    let generatedConnections = [];

    baseConnections.forEach(conn => {
        // Původní směr
        generatedConnections.push({ ...conn, id: `${conn.name}-tam`, direction: "tam" });

        // Opačný směr
        const reversedRoute = [...conn.route].reverse();

        generatedConnections.push({
            name: `${conn.name}`,
            type: conn.type,
            carrier: conn.carrier,
            route: reversedRoute,
            id: `${conn.name}-zpet`,
            direction: "zpět"
        });
    });
    return generatedConnections;
}