require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const { Worker } = require("worker_threads");
const prompt = require("prompt-sync")();

/* ------------ MENU ------------ */
console.log("\n=== B402 SPAM MINT ===");
console.log("1. RUN with .env");
console.log("2. RUN and paste JWT manually\n");

const choice = prompt("Select option (1/2): ").trim();

let JWT_INPUT = "";
if (choice === "1") {
    JWT_INPUT = process.env.JWT;
    if (!JWT_INPUT) {
        console.log("❌ ERROR: JWT not found in .env");
        process.exit(1);
    }
} else if (choice === "2") {
    JWT_INPUT = prompt("Paste JWT here: ").trim();
    if (!JWT_INPUT) {
        console.log("❌ ERROR: JWT empty");
        process.exit(1);
    }
} else {
    console.log("❌ Invalid choice");
    process.exit(1);
}

/* ------------ ORIGINAL CONFIG ------------ */
const {
    PRIVATE_KEY,
    JWT,
    MINT_COUNT,
    WORKER_COUNT,
    APPROVE,
    RPC = "https://bsc.drpc.org",
    API_BASE = "https://www.b402.ai/api/api/v1",
    RELAYER = "0xE1Af7DaEa624bA3B5073f24A6Ea5531434D82d88",
    TOKEN = "0x55d398326f99059fF775485246999027B3197955",
} = process.env;

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const WALLET = wallet.address;
const RECIPIENT = wallet.address;

const delay = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------ APPROVE FUNCTION ------------ */
async function approveUnlimited() {
    const abi = ["function approve(address spender, uint256 value)"];
    const token = new ethers.Contract(TOKEN, abi, wallet);
    const Max = ethers.MaxUint256;
    console.log("--- Approving unlimited USDT for relayer...");
    const tx = await token.approve(RELAYER, Max);
    console.log("--- Approve TX:", tx.hash);
    await tx.wait();
    console.log("--- Unlimited USDT approved!");
}
/* ------------ BUILD PERMIT ------------ */
async function buildPermit(amount, relayer) {
    const net = await provider.getNetwork();
    const now = Math.floor(Date.now() / 1000);
    const msg = {
        token: TOKEN,
        from: WALLET,
        to: WALLET, // USDT akan dikirim ke wallet PK lagi
        value: amount,
        validAfter: 0,
        validBefore: now + 1800,
        nonce: ethers.hexlify(ethers.randomBytes(32))
    };
    const domain = {
        name: "B402",
        version: "1",
        chainId: net.chainId,
        verifyingContract: relayer
    };
    const types = {
        TransferWithAuthorization: [
            { name: "token", type: "address" },
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" }
        ]
    };
    const sig = await wallet.signTypedData(domain, types, msg);
    return { authorization: msg, signature: sig };
}

/* ------------ MAIN ------------ */
(async () => {
    console.log("B402 - WORKERS - SPAM - OTW 🚀");
    const jwt = JWT;
    if (!APPROVE) {
        await approveUnlimited();
    }
    console.log("--- Fetching JWT ...");
    let pay;
    try {
        await axios.post(`${API_BASE}/faucet/drip`,
            { recipientAddress: RECIPIENT },
            { headers: { Authorization: `Bearer ${jwt}` } }
        );
    } catch (err) {
        if (err.response?.status === 402) {
            pay = err.response.data.paymentRequirements;
            console.log("--- JWT VALID");
        } else {
            throw new Error("--- JWT Invalid");
        }
    }
    const MINT = Number(MINT_COUNT);
    console.log(`--- Building ${MINT} permits in parallel...`);
    const permits = await Promise.all(
        [...Array(MINT)].map(async (_, i) => {
            const p = await buildPermit(pay.amount, pay.relayerContract);
            return p;
        })
    );
    console.log(`✔ Permit Success`);
    console.log(`\n[Spam ${WORKER_COUNT} workers]`);
    let nextTask = 0;
    let finished = 0;
    const results = new Array(MINT);
    const workers = [];
    function assignJob(worker) {
        if (nextTask >= MINT) return;
        const p = permits[nextTask];
        const jobIndex = nextTask;
        worker.busy = true;
        worker.postMessage({
            index: jobIndex + 1,
            jwt,
            API_BASE,
            RECIPIENT,
            TOKEN,
            p,
            pay,
        });
        nextTask++;
    }
    for (let i = 0; i < WORKER_COUNT; i++) {
        const worker = new Worker("./helper-workers.js");
        worker.busy = false;
        workers.push(worker);
        worker.on("message", (res) => {
            results[res.index - 1] = res;
            worker.busy = false;
            finished++;
            console.log(
                res.success
                    ? `🟩 Mint #${res.index} SUCCESS → ${res.tx}`
                    : `🟥 Mint #${res.index} FAILED → ${JSON.stringify(res.error)}`
            );
            if (finished === MINT) {
                console.log("\n🎉 DONE — ALL PERMITS FINISHED!");
                workers.forEach(w => w.terminate());
                return;
            }
            assignJob(worker);
        });
        worker.on("error", (err) => {
            console.log("❌ Worker error:", err);
        });
        worker.on("exit", (code) => {
            if (code !== 0) console.log(`⚠ Worker stopped, code=${code}`);
        });
        assignJob(worker);
    }
})();