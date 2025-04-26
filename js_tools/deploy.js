const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

const { rollup } = require('rollup');
const babel = require('@rollup/plugin-babel');
const commonjs = require('@rollup/plugin-commonjs');
const copy = require('rollup-plugin-copy');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const terser = require('@rollup/plugin-terser');

const { ScreepsAPI } = require('screeps-api');
const yaml = require('yamljs');
const argv = require('yargs')
    .option('server', {
        describe: '要连接的服务器；必须在 .screeps.yaml 的 servers 部分中定义',
        type: 'string',
        default: 'mmo',
    })
    // .demandOption('server')
    .option('dryrun', {
        describe: '执行干运行，跳过生成代码的上传',
        type: 'boolean',
        default: false,
    })
    .argv;

console.log("完整 process.argv:", process.argv);
console.log(`使用服务器 ${argv.server} 进行上传`);
const package_name_underscore = process.env.npm_package_name.replace(/\-/g, "_");

// 从 .screeps.yaml 文件加载配置
// 统一的配置格式：
// https://github.com/screepers/screepers-standards/blob/master/SS3-Unified_Credentials_File.md
function load_config() {
    // 解析 .screeps.yaml 文件
    const yaml_conf = yaml.parse(fs.readFileSync('.screeps.yaml', { encoding: 'utf8' }));
    const configs = yaml_conf.configs || {};

    // 检查是否为指定的服务器定义了配置
    if (!yaml_conf.servers[argv.server]) {
        console.log(`在 .screeps.yaml 中未找到服务器 ${argv.server} 的配置`);
        return;
    }

    const branch = yaml_conf.servers[argv.server].branch || 'default';

    // 是否在 rollup 中调用 terser 进行代码压缩
    // 优先读取 '*' 键的默认值，然后被服务器配置覆盖
    let use_terser = false;
    const terser_configs = configs.terser || {};
    if (terser_configs['*'] !== undefined) {
        use_terser = terser_configs['*'];
    }
    if (terser_configs[argv.server] !== undefined) {
        use_terser = terser_configs[argv.server];
    }

    // 传递给 wasm-pack 的额外选项 - 先追加 '*' 键的选项，然后追加服务器特定的选项
    let extra_options = [];
    const wasm_pack_options = configs['wasm-pack-options'] || {};
    if (wasm_pack_options['*']) {
        extra_options = extra_options.concat(wasm_pack_options['*']);
    }
    if (wasm_pack_options[argv.server]) {
        extra_options = extra_options.concat(wasm_pack_options[argv.server]);
    }

    return { branch, use_terser, extra_options };
}

// 清空 dist 和 pkg 目录中的任何现有构建结果
async function output_clean() {
    for (dir of ['dist', 'pkg']) {
        await fsExtra.emptyDir(dir);
    }
}

// 调用 wasm-pack，将 wasm 模块编译到 pkg 目录中
function run_wasm_pack(extra_options) {
    let args = ['build', '--target', 'web', '--release', '.', ...extra_options];
    const result = spawnSync('wasm-pack', args, { stdio: 'inherit' });
    if (result.status !== 0) {
        console.error('wasm-pack 运行失败，请检查输出日志');
    } else {
        console.log('wasm-pack 运行成功，生成的文件位于 pkg 目录');
    }
    return result;
}

// 在 main.js 文件上运行 rollup 打包器，将结果输出到 dist 目录
async function run_rollup(use_terser) {
    const wasm_file = `pkg/${package_name_underscore}_bg.wasm`;
    if (!fs.existsSync(wasm_file)) {
        console.error(`未找到 ${wasm_file} 文件，请检查 wasm-pack 是否正确生成`);
        return;
    }
    console.log(`找到 ${wasm_file} 文件，准备复制到 dist 目录`);
    const bundle = await rollup({
        input: 'js_src/main.js',
        plugins: [
            commonjs(), // 处理 CommonJS 模块
            nodeResolve(), // 解析 Node.js 模块
            babel({
                babelHelpers: 'bundled',
                presets: ['@babel/preset-env'], // 使用 Babel 转译为兼容的 JavaScript
                targets: {
                    "node": 12, // 目标环境为 Node.js 12
                },
            }),
            copy({
                targets: [{
                    src: wasm_file,
                    dest: 'dist',
                    rename: `${package_name_underscore}.wasm`, // 重命名输出的 wasm 文件
                }]
            }),
        ]
    });
    await bundle.write({
        format: 'cjs', // 输出为 CommonJS 格式
        file: 'dist/main.js',
        plugins: [use_terser && terser()], // 如果启用了 terser，则压缩代码
    });
}

// 从 dist 目录加载已构建的代码，并将其格式化为 API 所需的格式
function load_built_code() {
    let modules = {};
    let used_bytes = 0;

    const dist_files = fs.readdirSync('dist');
    console.log('dist 目录中的文件:', dist_files);

    dist_files.map(filename => {
        if (filename.endsWith('.wasm')) {
            console.log(`加载 wasm 文件: ${filename}`);
            const data = fs.readFileSync(path.join('dist', filename), { encoding: 'base64' });
            const filename_stripped = filename.replace(/\.wasm$/, '');
            used_bytes += data.length;
            modules[filename_stripped] = {
                binary: data,
            };
        } else {
            const data = fs.readFileSync(path.join('dist', filename), { encoding: 'utf8' });
            const filename_stripped = filename.replace(/\.js$/, '');
            used_bytes += data.length;
            modules[filename_stripped] = data;
        }
    });

    const used_mib = used_bytes / (1024 * 1024);
    const used_percent = 100 * used_mib / 5;

    return { used_mib, used_percent, modules };
}

// 使用 API 将代码上传到服务器（如果 dryrun 为 true，则模拟上传）
async function upload(code, server, branch, dryrun) {
    const usage_string = `${code.used_mib.toFixed(2)} MiB of 5.0 MiB code size limit (${code.used_percent.toFixed(2)}%)`;
    if (dryrun) {
        console.log(`由于 --dryrun，未上传；将使用 ${usage_string}`);
    } else {
        console.log(`上传到分支 ${branch}；使用 ${usage_string}`);
        const api = await ScreepsAPI.fromConfig(server);
        const response = await api.code.set(branch, code.modules);
        console.log(JSON.stringify(response));
    }
}

// 主运行函数
async function run() {
    const config = load_config();
    if (!config) {
        return;
    }
    await output_clean();
    const build_result = await run_wasm_pack(config.extra_options);
    if (build_result.status !== 0) {
        return;
    }
    await run_rollup(config.use_terser);
    const code = load_built_code();
    await upload(code, argv.server, config.branch, argv.dryrun);
}

// 捕获并打印运行时的任何错误
run().catch(console.error);
