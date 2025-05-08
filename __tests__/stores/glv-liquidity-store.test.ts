import { glvRegistry } from "../../src/helpers/web3";
import GlvLiquidityStore from "../../src/stores/glv-liquidity-store";

describe('GlvLiquidityStore', () => {
  let glvLiquidityStore: GlvLiquidityStore;

  beforeEach(() => {
    glvLiquidityStore = new GlvLiquidityStore();
  })

  it('should update glv token to liquid gm market mappings', async () => {
    await glvLiquidityStore._update();
    console.log(glvLiquidityStore.getGlvTokenToLiquidGmMarket());

    // Mock them to be updated
    glvRegistry.methods = {
      glvTokenToGmMarketForWithdrawal: jest.fn().mockImplementation((glvToken: string) => ({
        call: jest.fn().mockResolvedValue(
          glvToken.toLowerCase() === '0x528a5bac7e746c9a509a1f4f6df58a03d44279f9'
            ? '0x6ecf2133e2c9751caadcb6958b9654bae198a797'
            : '0xe2730ffe2136aa549327ebce93d58160df7821cb' // fallback or error case
        ),
      })),
      glvTokenToGmMarketForDeposit: jest.fn().mockImplementation((glvToken: string) => ({
        call: jest.fn().mockResolvedValue(
          glvToken.toLowerCase() === '0x528a5bac7e746c9a509a1f4f6df58a03d44279f9'
            ? '0x6ecf2133e2c9751caadcb6958b9654bae198a797'
            : '0xe2730ffe2136aa549327ebce93d58160df7821cb' // fallback or error case
        ),
      })),
    };
    await glvLiquidityStore._update();
    console.log(glvLiquidityStore.getGlvTokenToLiquidGmMarket());

    // Update mock to have GLV ETH as something different
    glvRegistry.methods = {
      glvTokenToGmMarketForWithdrawal: jest.fn().mockImplementation((glvToken: string) => ({
        call: jest.fn().mockResolvedValue(
          glvToken.toLowerCase() === '0x528a5bac7e746c9a509a1f4f6df58a03d44279f9'
            ? '0x1111111111111111111111111111111111111111'
            : '0xe2730ffe2136aa549327ebce93d58160df7821cb' // fallback or error case
        ),
      })),
      glvTokenToGmMarketForDeposit: jest.fn().mockImplementation((glvToken: string) => ({
        call: jest.fn().mockResolvedValue(
          glvToken.toLowerCase() === '0x528a5bac7e746c9a509a1f4f6df58a03d44279f9'
            ? '0x1111111111111111111111111111111111111111'
            : '0xe2730ffe2136aa549327ebce93d58160df7821cb' // fallback or error case
        ),
      })),
    };
    await glvLiquidityStore._update();
    console.log(glvLiquidityStore.getGlvTokenToLiquidGmMarket());
  });
});
