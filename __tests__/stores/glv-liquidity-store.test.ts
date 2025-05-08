import GlvLiquidityStore from "../../src/stores/glv-liquidity-store";

describe('GlvLiquidityStore', () => {
  let glvLiquidityStore: GlvLiquidityStore;

  beforeEach(() => {
    glvLiquidityStore = new GlvLiquidityStore();
  })

  it('should update glv token to liquid gm market mappings', async () => {
    await glvLiquidityStore._update();
    console.log(glvLiquidityStore.getGlvTokenToLiquidGmMarket());
  });
});
