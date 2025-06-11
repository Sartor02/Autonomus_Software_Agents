import { INTENT } from "../utils/utils.js";

export class Beliefs {
    constructor() {
        this.map = null;
        this.parcels = [];
        this.agents = [];
        this.myPosition = null;
        this.myScore = 0;
        this.availableParcels = [];
        this.deliveryTiles = [];
        this.spawnTiles = [];
        this.normalTiles = [];
        this.emptyTiles = [];
        this.myId = null;
        this.agentIntents = {}; // { agentId: { target: {x, y} } }
        this.myAssignedArea = null; // Area assigned to this agent
        this.agentRole = null; // Role of this agent (e.g., "explorer", "collector", etc.)
        this.handoverTile = null; // Tile where handover happens
        this.agentRoles = {};
        this.initialAgentPositions = {}; // Store initial positions of agents

        this.mapWidth = 0;
        this.mapHeight = 0;
    }

    updateFromSensing(data) {
        // Update parcel state
        if (data.parcels) {
            this.parcels = data.parcels.map(p => ({
                id: p.id,
                x: p.x,
                y: p.y,
                reward: p.reward,
                originalReward: p.originalReward,
                carriedBy: p.carriedBy,
                // Calculate distance only if my position is known
                distance: this.myPosition ? this.calculateDistance(p.x, p.y) : Infinity
            }));
        }

        // Update other agents
        if (data.agents) {
            this.agents = data.agents;
            // Update my position and id from agent data as well
            const me = this.agents.find(agent => agent.id === this.myId);
            if (me) {
                this.myPosition = { x: me.x, y: me.y };
                this.myScore = me.score;
            } else if (data.you) { // Fallback if onYou comes later or myId isn't set yet
                this.myId = data.you.id;
                this.myPosition = { x: data.you.x, y: data.you.y };
                this.myScore = data.you.score;
            }
        } else if (data.you) { // Handle initial onYou event
            this.myId = data.you.id;
            this.myPosition = { x: data.you.x, y: data.you.y };
            this.myScore = data.you.score;
        }


        // Calculate available parcels (not carried by others)
        this.availableParcels = this.parcels.filter(p => !p.carriedBy);
    }

    updateAgentIntent(agentId, msg) {
        try {
            const data = typeof msg === "string" ? JSON.parse(msg) : msg;
            if (data.type === INTENT) {
                this.agentIntents[agentId] = data;
            }
        } catch (e) {
            console.error(`Failed to update intent for agent ${agentId}:`, e);
        }
    }

    getOtherAgentsIntents(myId) {
        return Object.entries(this.agentIntents)
            .filter(([id]) => id !== myId)
            .map(([id, data]) => ({ agentId: id, ...data }));
    }

    // 0 = empty tile, 1 = spawn tile, 2 = delivery tile, 3 = normal tile
    updateMapInfo(width, height, tiles) {
        this.mapWidth = width; // Set map dimensions
        this.mapHeight = height;

        // Clear previous tile info
        this.emptyTiles = [];
        this.spawnTiles = [];
        this.deliveryTiles = [];
        this.normalTiles = [];

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const tileIndex = x * height + y; // Common grid to 1D mapping
                if (tileIndex >= 0 && tileIndex < tiles.length) {
                    const tile = tiles[tileIndex];
                    if (tile.type === 0) {
                        this.emptyTiles.push({ x, y });
                    } else if (tile.type === 1) {
                        this.spawnTiles.push({ x, y });
                    } else if (tile.type === 2) {
                        this.deliveryTiles.push({ x, y });
                    } else if (tile.type === 3) {
                        this.normalTiles.push({ x, y });
                    }
                } else {
                    console.warn(`Map tile index out of bounds: ${tileIndex} for map ${width}x${height}`);
                }
            }
        }
        console.log(`Map info updated: ${this.emptyTiles.length} empty, ${this.spawnTiles.length} spawn, ${this.deliveryTiles.length} delivery, ${this.normalTiles.length} normal tiles.`);
    }

    isDeliveryTile(x, y) {
        return this.deliveryTiles.some(t => t.x === x && t.y === y);
    }

    getClosestDeliveryTile(currentX, currentY) {
        if (this.deliveryTiles.length === 0) return null;

        let closest = null;
        let minDist = Infinity;

        for (const tile of this.deliveryTiles) {
            const dist = Math.abs(tile.x - currentX) + Math.abs(tile.y - currentY); // Manhattan distance
            if (dist < minDist) {
                minDist = dist;
                closest = tile;
            }
        }
        return closest;
    }

    calculateDistance(x, y) {
        // Calculate Manhattan distance from the current position
        if (!this.myPosition) return Infinity;
        return Math.abs(x - this.myPosition.x) + Math.abs(y - this.myPosition.y);
    }

    isWalkable(x, y) {
        // Check boundaries first
        if (x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight) {
            return false;
        }

        // A tile is walkable if it's not an empty tile (type 0)
        const isStaticObstacle = this.emptyTiles.some(t => t.x === x && t.y === y);
        if (isStaticObstacle) {
            return false;
        }

        // Also check if another agent is currently on this tile
        // We only care about *other* agents blocking the path
        const isBlockedByOtherAgent = this.agents.some(agent =>
            agent.id !== this.myId && // Check if it's NOT me
            Math.floor(agent.x) === x && // Check integer coordinates
            Math.floor(agent.y) === y
        );

        return !isBlockedByOtherAgent;
    }

    // Method to get all walkable tiles (useful for exploration target selection)
    getAllWalkableTiles() {
        return [...this.spawnTiles, ...this.deliveryTiles, ...this.normalTiles];
    }

    getSpawnTiles() {
        return this.spawnTiles;
    }

    getNormalTiles() {
        return this.normalTiles;
    }

    getDeliveryTiles() {
        return this.deliveryTiles;
    }

    getSpawnAreasFromTiles() {
        // Trova tutte le tile di spawn
        const spawnTiles = this.getSpawnTiles()
        const visited = new Set();
        const areas = [];

        const directions = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
        ];

        for (const tile of spawnTiles) {
            const key = `${tile.x},${tile.y}`;
            if (visited.has(key)) continue;

            // BFS per trovare tutte le tile adiacenti
            const area = [];
            const queue = [tile];
            visited.add(key);

            while (queue.length > 0) {
                const current = queue.shift();
                area.push(current);

                for (const { dx, dy } of directions) {
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    const nkey = `${nx},${ny}`;
                    if (visited.has(nkey)) continue;
                    const neighbor = spawnTiles.find(t => t.x === nx && t.y === ny);
                    if (neighbor) {
                        queue.push(neighbor);
                        visited.add(nkey);
                    }
                }
            }
            areas.push(area);
        }
        return areas; // Array di array di tile di spawn adiacenti
    }

    hasParcel() {
        return this.parcels.some(p => p.carriedBy === this.myId);
    }

    setAgentPosition(id, position) {
        this.initialAgentPositions[id] = position;
    }
}