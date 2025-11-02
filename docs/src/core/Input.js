export class InputManager {
  constructor(scene) {
    this.scene = scene;
    this.keys = scene.input.keyboard.addKeys({
      up: 'W', left: 'A', down: 'S', right: 'D',
      interact: 'E', dash: 'SPACE', q: 'Q', r: 'R', tab: 'TAB', ability: 'F', melee: 'C'
    });
    this.pointer = scene.input.activePointer;
  }
  get moveVec() {
    const v = { x: 0, y: 0 };
    if (this.keys.left.isDown) v.x -= 1;
    if (this.keys.right.isDown) v.x += 1;
    if (this.keys.up.isDown) v.y -= 1;
    if (this.keys.down.isDown) v.y += 1;
    const len = Math.hypot(v.x, v.y) || 1;
    v.x /= len; v.y /= len;
    return v;
  }
  get pressedInteract() { return Phaser.Input.Keyboard.JustDown(this.keys.interact); }
  get pressedDash() { return Phaser.Input.Keyboard.JustDown(this.keys.dash); }
  get pressedTab() { return Phaser.Input.Keyboard.JustDown(this.keys.tab); }
  get pressedAbility() { return Phaser.Input.Keyboard.JustDown(this.keys.ability); }
  get pressedMelee() { return Phaser.Input.Keyboard.JustDown(this.keys.melee); }
  get isLMBDown() { return this.pointer.isDown && this.pointer.buttons === 1; }
  get pressedLMB() { return !!this.pointer.justDown && this.pointer.buttons === 1; }
}
