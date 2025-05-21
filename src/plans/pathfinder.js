import { DIRECTIONS } from "../utils/utils.js";

export class Pathfinder {
    constructor(beliefs) {
        this.beliefs = beliefs;
    }

    // Manhattan distance heuristic
    heuristic(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    // A* pathfinding algorithm
    findPath(startX, startY, targetX, targetY) {
        const start = { x: startX, y: startY };
        const target = { x: targetX, y: targetY };

        if (!this.beliefs.isWalkable(target.x, target.y)) {
            console.warn(`Target tile ${target.x},${target.y} is not walkable.`);
            // Try to find the nearest walkable tile to the target if the target itself is not walkable
            const nearestValid = this.findNearestValidTile(target.x, target.y);
            if (nearestValid) {
                console.warn(`Retrying pathfinding to nearest valid tile ${nearestValid.x},${nearestValid.y}`);
                target.x = nearestValid.x;
                target.y = nearestValid.y;
            } else {
                console.error(`Could not find a path to target ${target.x},${target.y} as it's not walkable and no nearby valid tile found.`);
                return []; // No path possible
            }
        }
        if (!this.beliefs.isWalkable(start.x, start.y)) {
            console.error(`Start tile ${start.x},${start.y} is not walkable.`);
            return []; // Cannot start from an unwalkable tile
        }


        // Node structure for A*
        class Node {
            constructor(x, y, g, h, parent = null) {
                this.x = x;
                this.y = y;
                this.g = g; // Cost from start
                this.h = h; // Heuristic cost to target
                this.f = g + h; // Total cost
                this.parent = parent;
            }

            equals(other) {
                return this.x === other.x && this.y === other.y;
            }

            getKey() {
                return `${this.x},${this.y}`;
            }
        }

        const openSet = new Set(); // Use a Set for quick lookups
        const openSetNodes = new Map(); // Map key -> Node for quick node access
        const closedSet = new Set(); // Use a Set for quick lookups

        const startNode = new Node(startX, startY, 0, this.heuristic(startX, startY, target.x, target.y));
        openSet.add(startNode.getKey());
        openSetNodes.set(startNode.getKey(), startNode);

        const directions = DIRECTIONS;

        while (openSet.size > 0) {
            // Find the node with the lowest f-score in the open set
            let currentNode = null;
            let minF = Infinity;
            for (const key of openSet) {
                const node = openSetNodes.get(key);
                if (node.f < minF) {
                    minF = node.f;
                    currentNode = node;
                }
            }

            if (!currentNode) return; // No valid node found, exit
            // Remove current node from open set and add to closed set
            openSet.delete(currentNode.getKey());
            closedSet.add(currentNode.getKey());

            // If we reached the target
            if (currentNode.equals(target)) {
                return this.reconstructPath(currentNode);
            }

            // Explore neighbors
            for (const dir of directions) {
                const neighborX = currentNode.x + dir.dx;
                const neighborY = currentNode.y + dir.dy;
                const neighborKey = `${neighborX},${neighborY}`;

                // Check boundaries and walkability
                if (neighborX < 0 || neighborX >= this.beliefs.mapWidth ||
                    neighborY < 0 || neighborY >= this.beliefs.mapHeight ||
                    !this.beliefs.isWalkable(neighborX, neighborY)) {
                    continue;
                }

                // If neighbor is in the closed set, skip
                if (closedSet.has(neighborKey)) {
                    continue;
                }

                const tentativeG = currentNode.g + 1; // Cost to move to a neighbor is 1

                // If neighbor is not in the open set or the new path is better
                if (!openSet.has(neighborKey) || tentativeG < openSetNodes.get(neighborKey).g) {
                    const neighborNode = new Node(
                        neighborX, neighborY,
                        tentativeG,
                        this.heuristic(neighborX, neighborY, target.x, target.y),
                        currentNode // Set parent
                    );

                    if (!openSet.has(neighborKey)) {
                        openSet.add(neighborKey);
                        openSetNodes.set(neighborKey, neighborNode);
                    } else {
                        // Update the node in the map if the path is better
                        openSetNodes.set(neighborKey, neighborNode);
                    }
                }
            }
        }

        // If the loop finishes and the target was not reached
        console.warn(`A* failed to find a path from ${startX},${startY} to ${target.x},${target.y}`);
        return []; // No path found
    }

    // Breadth-First Search to find the nearest valid tile
    findNearestValidTile(startX, startY) {
        const start = { x: startX, y: startY };

        if (this.beliefs.isWalkable(start.x, start.y)) {
            return start; // Already on a valid tile
        }

        const queue = [start];
        const visited = new Set();
        visited.add(`${start.x},${start.y}`);

        const directions = DIRECTIONS;

        while (queue.length > 0) {
            const current = queue.shift();

            for (const dir of directions) {
                const nextX = current.x + dir.dx;
                const nextY = current.y + dir.dy;
                const key = `${nextX},${nextY}`;

                // Check boundaries
                if (nextX < 0 || nextX >= this.beliefs.mapWidth ||
                    nextY < 0 || nextY >= this.beliefs.mapHeight) {
                    continue;
                }

                if (!visited.has(key)) {
                    visited.add(key);

                    if (this.beliefs.isWalkable(nextX, nextY)) {
                        return { x: nextX, y: nextY }; // Found nearest valid tile
                    }

                    queue.push({ x: nextX, y: nextY });
                }
            }
        }

        return null; // No valid tile found
    }


    // Reconstruct path from target node
    reconstructPath(targetNode) {
        const path = [];
        let currentNode = targetNode;
        while (currentNode !== null) {
            path.push({ x: currentNode.x, y: currentNode.y });
            currentNode = currentNode.parent;
        }
        // Reverse the path to get it from start to target (excluding the start node itself, as we are already there)
        return path.reverse().slice(1);
    }

    // Helper to get the action (move direction) from current position to next position in path
    getActionToNextStep(currentX, currentY, nextX, nextY) {
        const dx = nextX - currentX;
        const dy = nextY - currentY;

        if (dx === 1) return 'move_right';
        if (dx === -1) return 'move_left';
        if (dy === 1) return 'move_up';
        if (dy === -1) return 'move_down';

        return null; // Should not happen if path is valid
    }
}