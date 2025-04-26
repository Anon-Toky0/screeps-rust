"use strict";
import 'fastestsmallesttextencoderdecoder-encodeinto/EncoderDecoderTogether.min.js';

import * as bot from '../pkg/screeps_rust.js';
// 将此替换为您的模块名称
const MODULE_NAME = "screeps_rust";
const BUCKET_BOOT_THRESHOLD = 1500;

/* // 该函数提供了 `console.error`，wasm_bindgen 有时会期望它存在，
// 特别是在调试模式下进行类型检查时。另一种选择是将其定义为 `function () {}`，
// 并让异常处理程序记录抛出的 JS 异常，但 wasm_bindgen 传递到这里的一些额外信息可能会丢失。
//
// 这个函数没有什么特别之处，任何 JS/Rust 代码都可以将其用作一种便利工具。
function console_error() {
    const processedArgs = _.map(arguments, (arg) => {
        if (arg instanceof Error) {
            // 在此版本的 Node 中，错误的 `stack` 属性包含了消息本身。
            return arg.stack;
        } else {
            return arg;
        }
    }).join(' ');
    console.log("ERROR:", processedArgs);
    Game.notify(processedArgs);
} */

// 跟踪每个 tick 中运行 wasm 循环是否完成，以检测错误或中止的执行
let running = false;

function loaded_loop() {
    // 每个 tick 都需要重新覆盖伪造的 console 对象
    console.error = console_error;
    if (running) {
        // 上一个 tick 中发生了错误；跳过当前 tick 的执行，要求立即销毁我们的 IVM，
        // 以便在下一个 tick 中获得一个新的环境；
        // 这是 https://github.com/rustwasm/wasm-bindgen/issues/3130 的解决方法
        Game.cpu.halt();
    } else {
        try {
            running = true;
            bot.loop();
            // 如果由于任何原因（错误或 CPU 用尽取消）未能执行到此处，
            // 则不会将 running 设置为 false，这将在下一个 tick 中导致 halt()
            running = false;
        } catch (error) {
            console.log(`捕获异常，下一个 tick 将停止：${error}`);
            // 不记录堆栈，因为我们已经通过 panic 钩子从 rust 记录了堆栈跟踪，
            // 而且通常那个更好，但如果需要，可以取消注释以下代码：

            // if (error.stack) {
            //     console.log("js 堆栈:", error.stack);
            // }
        }
    }
}

// 缓存 wasm 模块初始化的每个步骤
let wasm_bytes, wasm_module, wasm_instance;

module.exports.loop = function() {
    // 每个 tick 都需要重新覆盖伪造的 console 对象
    // console.error = console_error;

    // 仅在 bucket 充足时尝试加载 wasm
    if (Game.cpu.bucket < BUCKET_BOOT_THRESHOLD) {
        console.log(`启动延迟；需要 ${BUCKET_BOOT_THRESHOLD} bucket，当前为 ${Game.cpu.bucket}`);
        return;
    }

    // 运行加载过程的每个步骤，保存每个结果，以便可以跨多个 tick 完成
    if (!wasm_bytes) wasm_bytes = require(MODULE_NAME);
    if (!wasm_module) wasm_module = new WebAssembly.Module(wasm_bytes);
    if (!wasm_instance) wasm_instance = bot.initSync({ module: wasm_module });

    // 从堆和 require 缓存中移除字节，我们不再需要它们
    wasm_bytes = null;
    delete require.cache[MODULE_NAME];
    // 用加载后的循环替换此函数，以便在下一个 tick 中使用
    module.exports.loop = loaded_loop;
    console.log(`加载完成，CPU 使用量：${Game.cpu.getUsed()}`)
}
