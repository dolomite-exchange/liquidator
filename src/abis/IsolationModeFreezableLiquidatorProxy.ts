/* Autogenerated file. Do not edit manually. */
import type { FunctionFragment, Result } from '@ethersproject/abi';
import type { Provider } from '@ethersproject/providers';
/* tslint:disable */
/* eslint-disable */
import type {
  BaseContract,
  BigNumber,
  BigNumberish,
  BytesLike,
  CallOverrides,
  ContractTransaction,
  PayableOverrides,
  PopulatedTransaction,
  Signer,
  utils,
} from 'ethers';

export declare namespace IDolomiteStructs {
  export type AccountInfoStruct = { owner: string; number: BigNumberish };

  export type AccountInfoStructOutput = [string, BigNumber] & {
    owner: string;
    number: BigNumber;
  };
}

export declare namespace IIsolationModeFreezableLiquidatorProxy {
  export type PrepareForLiquidationParamsStruct = {
    liquidAccount: IDolomiteStructs.AccountInfoStruct;
    freezableMarketId: BigNumberish;
    inputTokenAmount: BigNumberish;
    outputMarketId: BigNumberish;
    minOutputAmount: BigNumberish;
    expirationTimestamp: BigNumberish;
    extraData: BytesLike;
  };

  export type PrepareForLiquidationParamsStructOutput = [
    IDolomiteStructs.AccountInfoStructOutput,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber,
    string
  ] & {
    liquidAccount: IDolomiteStructs.AccountInfoStructOutput;
    freezableMarketId: BigNumber;
    inputTokenAmount: BigNumber;
    outputMarketId: BigNumber;
    minOutputAmount: BigNumber;
    expirationTimestamp: BigNumber;
    extraData: string;
  };
}

export interface IsolationModeFreezableLiquidatorProxyInterface
  extends utils.Interface {
  functions: {
    'DOLOMITE_MARGIN()': FunctionFragment;
    'DOLOMITE_MARGIN_OWNER()': FunctionFragment;
    'DOLOMITE_REGISTRY()': FunctionFragment;
    'EXPIRY()': FunctionFragment;
    'LIQUIDATOR_ASSET_REGISTRY()': FunctionFragment;
    'prepareForLiquidation(((address,uint256),uint256,uint256,uint256,uint256,uint256,bytes))': FunctionFragment;
  };
  events: {};

  getFunction(
    nameOrSignatureOrTopic:
      | 'DOLOMITE_MARGIN'
      | 'DOLOMITE_MARGIN_OWNER'
      | 'DOLOMITE_REGISTRY'
      | 'EXPIRY'
      | 'LIQUIDATOR_ASSET_REGISTRY'
      | 'prepareForLiquidation',
  ): FunctionFragment;

  encodeFunctionData(
    functionFragment: 'DOLOMITE_MARGIN',
    values?: undefined,
  ): string;

  encodeFunctionData(
    functionFragment: 'DOLOMITE_MARGIN_OWNER',
    values?: undefined,
  ): string;

  encodeFunctionData(
    functionFragment: 'DOLOMITE_REGISTRY',
    values?: undefined,
  ): string;

  encodeFunctionData(functionFragment: 'EXPIRY', values?: undefined): string;

  encodeFunctionData(
    functionFragment: 'LIQUIDATOR_ASSET_REGISTRY',
    values?: undefined,
  ): string;

  encodeFunctionData(
    functionFragment: 'prepareForLiquidation',
    values: [
      IIsolationModeFreezableLiquidatorProxy.PrepareForLiquidationParamsStruct
    ],
  ): string;

  decodeFunctionResult(
    functionFragment: 'DOLOMITE_MARGIN',
    data: BytesLike,
  ): Result;

  decodeFunctionResult(
    functionFragment: 'DOLOMITE_MARGIN_OWNER',
    data: BytesLike,
  ): Result;

  decodeFunctionResult(
    functionFragment: 'DOLOMITE_REGISTRY',
    data: BytesLike,
  ): Result;

  decodeFunctionResult(functionFragment: 'EXPIRY', data: BytesLike): Result;

  decodeFunctionResult(
    functionFragment: 'LIQUIDATOR_ASSET_REGISTRY',
    data: BytesLike,
  ): Result;

  decodeFunctionResult(
    functionFragment: 'prepareForLiquidation',
    data: BytesLike,
  ): Result;
}

export interface IsolationModeFreezableLiquidatorProxy extends BaseContract {
  interface: IsolationModeFreezableLiquidatorProxyInterface;
  functions: {
    DOLOMITE_MARGIN(overrides?: CallOverrides): Promise<[string]>;

    DOLOMITE_MARGIN_OWNER(overrides?: CallOverrides): Promise<[string]>;

    DOLOMITE_REGISTRY(overrides?: CallOverrides): Promise<[string]>;

    EXPIRY(overrides?: CallOverrides): Promise<[string]>;

    LIQUIDATOR_ASSET_REGISTRY(overrides?: CallOverrides): Promise<[string]>;

    prepareForLiquidation(
      _params: IIsolationModeFreezableLiquidatorProxy.PrepareForLiquidationParamsStruct,
      overrides?: PayableOverrides & { from?: string },
    ): Promise<ContractTransaction>;
  };
  callStatic: {
    DOLOMITE_MARGIN(overrides?: CallOverrides): Promise<string>;

    DOLOMITE_MARGIN_OWNER(overrides?: CallOverrides): Promise<string>;

    DOLOMITE_REGISTRY(overrides?: CallOverrides): Promise<string>;

    EXPIRY(overrides?: CallOverrides): Promise<string>;

    LIQUIDATOR_ASSET_REGISTRY(overrides?: CallOverrides): Promise<string>;

    prepareForLiquidation(
      _params: IIsolationModeFreezableLiquidatorProxy.PrepareForLiquidationParamsStruct,
      overrides?: CallOverrides,
    ): Promise<void>;
  };
  filters: {};
  estimateGas: {
    DOLOMITE_MARGIN(overrides?: CallOverrides): Promise<BigNumber>;

    DOLOMITE_MARGIN_OWNER(overrides?: CallOverrides): Promise<BigNumber>;

    DOLOMITE_REGISTRY(overrides?: CallOverrides): Promise<BigNumber>;

    EXPIRY(overrides?: CallOverrides): Promise<BigNumber>;

    LIQUIDATOR_ASSET_REGISTRY(overrides?: CallOverrides): Promise<BigNumber>;

    prepareForLiquidation(
      _params: IIsolationModeFreezableLiquidatorProxy.PrepareForLiquidationParamsStruct,
      overrides?: PayableOverrides & { from?: string },
    ): Promise<BigNumber>;
  };
  populateTransaction: {
    DOLOMITE_MARGIN(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    DOLOMITE_MARGIN_OWNER(
      overrides?: CallOverrides,
    ): Promise<PopulatedTransaction>;

    DOLOMITE_REGISTRY(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    EXPIRY(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    LIQUIDATOR_ASSET_REGISTRY(
      overrides?: CallOverrides,
    ): Promise<PopulatedTransaction>;

    prepareForLiquidation(
      _params: IIsolationModeFreezableLiquidatorProxy.PrepareForLiquidationParamsStruct,
      overrides?: PayableOverrides & { from?: string },
    ): Promise<PopulatedTransaction>;
  };

  connect(signerOrProvider: Signer | Provider | string): this;

  attach(addressOrName: string): this;

  deployed(): Promise<this>;

  DOLOMITE_MARGIN(overrides?: CallOverrides): Promise<string>;

  DOLOMITE_MARGIN_OWNER(overrides?: CallOverrides): Promise<string>;

  DOLOMITE_REGISTRY(overrides?: CallOverrides): Promise<string>;

  EXPIRY(overrides?: CallOverrides): Promise<string>;

  LIQUIDATOR_ASSET_REGISTRY(overrides?: CallOverrides): Promise<string>;

  prepareForLiquidation(
    _params: IIsolationModeFreezableLiquidatorProxy.PrepareForLiquidationParamsStruct,
    overrides?: PayableOverrides & { from?: string },
  ): Promise<ContractTransaction>;
}
