export class GreedyStrategy {
    constructor(beliefs, deliveryStrategy) {
        this.beliefs = beliefs;
        this.deliveryStrategy = deliveryStrategy;
    }
  
    selectBestParcel() {
      if (!this.beliefs.availableParcels.length) return null;
      
    // Sort by reward/distance (efficiency)
    return this.beliefs.availableParcels
      .map(p => ({
        ...p,
        efficiency: p.reward / (p.distance + 0.1) // Avoid division by zero
      }))
      .sort((a, b) => b.efficiency - a.efficiency)[0];
    }
  
    getAction() {
        // First check if you need to deliver
        const deliveryAction = this.deliveryStrategy.getDeliveryAction();
        if (deliveryAction) return deliveryAction;

        // Then proceed with collection
        const bestParcel = this.selectBestParcel();
        if (!bestParcel) return this.explore();
        
        if (bestParcel.x === this.beliefs.myPosition.x && 
        bestParcel.y === this.beliefs.myPosition.y) {
            return { action: 'pickup', target: bestParcel.id };
        }
        
        return this.calculateMoveTowards(bestParcel.x, bestParcel.y);
    }
  
    calculateMoveTowards(targetX, targetY) {
        // Simplified implementation - improve with A*
        const dx = targetX - this.beliefs.myPosition.x;
        const dy = targetY - this.beliefs.myPosition.y;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            return { action: dx > 0 ? 'move_right' : 'move_left' };
        } else {
            return { action: dy > 0 ? 'move_up' : 'move_down' };
        }
    }

    //FIXME: Implement something like A*
    explore() {
        const possibleActions = ['move_up', 'move_down', 'move_left', 'move_right'];
        const randomIndex = Math.floor(Math.random() * possibleActions.length);
        return { action: possibleActions[randomIndex] };
    }
  }