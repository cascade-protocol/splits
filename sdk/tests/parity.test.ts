/**
 * Parity tests to verify kit and web3 instruction builders produce identical output
 */

import { describe, it, expect } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { address } from "@solana/kit";
import * as web3 from "../src/web3";
import * as kit from "../src/kit";

describe("Instruction Parity", () => {
  const authority = Keypair.generate();
  const mint = Keypair.generate();
  const uniqueId = Keypair.generate();
  const feeWallet = Keypair.generate();
  const newAuthority = Keypair.generate();
  const executor = Keypair.generate();

  const recipients = [
    { address: Keypair.generate().publicKey.toBase58(), percentageBps: 5000 },
    { address: Keypair.generate().publicKey.toBase58(), percentageBps: 4900 },
  ];

  it("buildInitializeProtocolInstruction produces identical data", () => {
    const web3Ix = web3.buildInitializeProtocolInstruction(
      authority.publicKey,
      feeWallet.publicKey
    );

    const kitIx = kit.buildInitializeProtocolInstruction(
      address(authority.publicKey.toBase58()),
      address(feeWallet.publicKey.toBase58())
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });

  it("buildUpdateProtocolConfigInstruction produces identical data", () => {
    const web3Ix = web3.buildUpdateProtocolConfigInstruction(
      authority.publicKey,
      feeWallet.publicKey
    );

    const kitIx = kit.buildUpdateProtocolConfigInstruction(
      address(authority.publicKey.toBase58()),
      address(feeWallet.publicKey.toBase58())
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });

  it("buildTransferProtocolAuthorityInstruction produces identical data", () => {
    const web3Ix = web3.buildTransferProtocolAuthorityInstruction(
      authority.publicKey,
      newAuthority.publicKey
    );

    const kitIx = kit.buildTransferProtocolAuthorityInstruction(
      address(authority.publicKey.toBase58()),
      address(newAuthority.publicKey.toBase58())
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });

  it("buildAcceptProtocolAuthorityInstruction produces identical data", () => {
    const web3Ix = web3.buildAcceptProtocolAuthorityInstruction(
      newAuthority.publicKey
    );

    const kitIx = kit.buildAcceptProtocolAuthorityInstruction(
      address(newAuthority.publicKey.toBase58())
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });

  it("buildCreateSplitConfigInstruction produces identical data", () => {
    const web3Ix = web3.buildCreateSplitConfigInstruction(
      authority.publicKey,
      mint.publicKey,
      uniqueId.publicKey,
      recipients
    );

    const kitIx = kit.buildCreateSplitConfigInstruction(
      address(authority.publicKey.toBase58()),
      address(mint.publicKey.toBase58()),
      address(uniqueId.publicKey.toBase58()),
      recipients
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });

  it("buildExecuteSplitInstruction produces identical data", () => {
    const splitConfig = Keypair.generate().publicKey;
    const vault = Keypair.generate().publicKey;
    const protocolAta = Keypair.generate().publicKey;
    const recipientAtas = [
      Keypair.generate().publicKey,
      Keypair.generate().publicKey,
    ];

    const web3Ix = web3.buildExecuteSplitInstruction(
      splitConfig,
      vault,
      mint.publicKey,
      executor.publicKey,
      recipientAtas,
      protocolAta
    );

    const kitIx = kit.buildExecuteSplitInstruction(
      address(splitConfig.toBase58()),
      address(vault.toBase58()),
      address(mint.publicKey.toBase58()),
      address(executor.publicKey.toBase58()),
      recipientAtas.map(a => address(a.toBase58())),
      address(protocolAta.toBase58())
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });

  it("buildUpdateSplitConfigInstruction produces identical data", () => {
    const splitConfig = Keypair.generate().publicKey;
    const vault = Keypair.generate().publicKey;

    const web3Ix = web3.buildUpdateSplitConfigInstruction(
      splitConfig,
      vault,
      mint.publicKey,
      authority.publicKey,
      recipients
    );

    const kitIx = kit.buildUpdateSplitConfigInstruction(
      address(splitConfig.toBase58()),
      address(vault.toBase58()),
      address(mint.publicKey.toBase58()),
      address(authority.publicKey.toBase58()),
      recipients
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });

  it("buildCloseSplitConfigInstruction produces identical data", () => {
    const splitConfig = Keypair.generate().publicKey;
    const vault = Keypair.generate().publicKey;

    const web3Ix = web3.buildCloseSplitConfigInstruction(
      splitConfig,
      vault,
      authority.publicKey
    );

    const kitIx = kit.buildCloseSplitConfigInstruction(
      address(splitConfig.toBase58()),
      address(vault.toBase58()),
      address(authority.publicKey.toBase58())
    );

    expect(Buffer.from(kitIx.data!)).toEqual(web3Ix.data);
    expect(kitIx.accounts!.length).toEqual(web3Ix.keys.length);
  });
});
