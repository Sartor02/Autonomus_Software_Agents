export class AreaManager {
    constructor(beliefs) {
        this.beliefs = beliefs;
        this.areaAnnounced = false;
    }

    getAssignedSpawnArea(knownAgents, myId) {
        const areas = this.beliefs.getSpawnAreasFromTiles();
        const normalTiles = this.beliefs.getNormalTiles ? this.beliefs.getNormalTiles() : [];
        const treatAsSingleArea = normalTiles.length === 0;

        if (areas.length === 1 || treatAsSingleArea) {
            return this.handleSingleArea(areas, knownAgents, myId, treatAsSingleArea);
        }

        return this.handleMultipleAreas(areas, knownAgents, myId);
    }

    announceAreaIfAllAgentsKnown(knownAgents, myId, expectedAgents, communicationHandler) {
        if (this.areaAnnounced || knownAgents.size !== expectedAgents) {
            return false;
        }

        console.log(`[AGENT - ${myId}] All agents known (${knownAgents.size}/${expectedAgents}). Announcing area intent.`);
        
        const areaTiles = this.getAssignedSpawnArea(knownAgents, myId);
        if (areaTiles) {
            console.log(`[AGENT - ${myId}] Assigned area tiles:`, areaTiles);
            
            const area = areaTiles.map(tile => ({ x: tile.x, y: tile.y }));
            communicationHandler.announceAreaIntent(myId, area, knownAgents);
            
            this.areaAnnounced = true;
            this.beliefs.myAssignedArea = areaTiles;
            return true;
        }
        
        return false;
    }

    handleSingleArea(areas, knownAgents, myId, treatAsSingleArea) {
        const area = treatAsSingleArea ? areas.flat() : areas[0];
        const sortedAgents = this.getSortedAgents(knownAgents, myId);
        const myIndex = sortedAgents.indexOf(myId);

        return this.divideArea(area, myIndex);
    }

    handleMultipleAreas(areas, knownAgents, myId) {
        const sortedAgents = this.getSortedAgents(knownAgents, myId);
        const myIndex = sortedAgents.indexOf(myId);
        const sortedAreas = [...areas].sort((a, b) => b.length - a.length);

        return sortedAreas[myIndex % sortedAreas.length];
    }

    getSortedAgents(knownAgents, myId) {
        const allAgents = Array.from(knownAgents);
        allAgents.push(myId);
        return allAgents.sort();
    }

    divideArea(area, myIndex) {
        const bounds = this.getAreaBounds(area);
        
        if ((bounds.maxX - bounds.minX) >= (bounds.maxY - bounds.minY)) {
            return this.divideVertically(area, bounds, myIndex);
        } else {
            return this.divideHorizontally(area, bounds, myIndex);
        }
    }

    getAreaBounds(area) {
        return {
            minX: Math.min(...area.map(t => t.x)),
            maxX: Math.max(...area.map(t => t.x)),
            minY: Math.min(...area.map(t => t.y)),
            maxY: Math.max(...area.map(t => t.y))
        };
    }

    divideVertically(area, bounds, myIndex) {
        const midX = Math.floor((bounds.minX + bounds.maxX) / 2);
        return area.filter(t => myIndex === 0 ? t.x <= midX : t.x > midX);
    }

    divideHorizontally(area, bounds, myIndex) {
        const midY = Math.floor((bounds.minY + bounds.maxY) / 2);
        return area.filter(t => myIndex === 0 ? t.y <= midY : t.y > midY);
    }
}