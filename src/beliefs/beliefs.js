export class Beliefs {
    constructor() {
        this.map = null;
        this.parcels = [];
        this.agents = [];
        this.myPosition = null;
        this.myScore = 0;
        this.availableParcels = [];
        this.deliveryTiles = [];
        this.myId = null; 
    }
  
    updateFromSensing(data) {
      // Update parcel state
      if (!data.parcels) return;
      this.parcels = data.parcels.map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        reward: p.reward,
        carriedBy: p.carriedBy,
        // Calculate distance only if my position is known
        distance: this.myPosition ? this.calculateDistance(p.x, p.y) : Infinity
      }));
  
      // Update other agents
      this.agents = data.agents;
      
      // Calculate available parcels (not carried by others)
      this.availableParcels = this.parcels.filter(p => !p.carriedBy);
    }

    updateMapInfo(width, height, tiles) {
        this.deliveryTiles = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tile = tiles[y * width + x];
                if (tile.type === 2) { // 2 = delivery tile
                    this.deliveryTiles.push({x, y});
                }
            }
        }
    }
    
    isDeliveryTile(x, y) {
    return this.deliveryTiles.some(t => t.x === x && t.y === y);
    }
    
    getClosestDeliveryTile(currentX, currentY) {
    if (this.deliveryTiles.length === 0) return null;
    
    return this.deliveryTiles.reduce((closest, tile) => {
        const dist = Math.abs(tile.x - currentX) + Math.abs(tile.y - currentY);
        return dist < closest.distance ? {tile, distance: dist} : closest;
    }, {tile: null, distance: Infinity}).tile;
    }
  
    calculateDistance(x, y) {
      // Calculate Manhattan distance from the current position
      return Math.abs(x - this.myPosition.x) + Math.abs(y - this.myPosition.y);
    }
  }