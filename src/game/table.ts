/** 球桌与物件的尺寸，模拟、AI 与画面共用。单位是球桌坐标里的像素。 */
export const TABLE_WIDTH = 800;
export const TABLE_HEIGHT = 450;
export const GOAL_HEIGHT = 160;
export const GOAL_TOP = TABLE_HEIGHT / 2 - GOAL_HEIGHT / 2;
export const GOAL_BOTTOM = TABLE_HEIGHT / 2 + GOAL_HEIGHT / 2;
export const GOAL_ZONE_RADIUS = 85;
// 球拍与冰球比最初的 30 和 20 小：按球桌短边算，原来的球拍直径占 13%，
// 真实气垫球桌约为 8%。物件小一些，球路和弧线才有地方展开。
export const PADDLE_RADIUS = 26;
export const PUCK_RADIUS = 15;
export const LINE_THICKNESS = 3;
export const WIN_SCORE = 7;
