export interface GameState {
  p1Y: number;
  p2Y: number;
  puckX: number;
  puckY: number;
  puckVelX: number;
  puckVelY: number;
  score1: number;
  score2: number;
}

export interface HockeyRef {
  updateState: (data: Partial<GameState>) => void;
  resetGame: () => void;
}