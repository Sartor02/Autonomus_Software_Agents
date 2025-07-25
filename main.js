import readline from 'readline';
import config from "./config.js";
import Agent from './src/agent.js';
import * as utils from './src/utils/utils.js';

// ANSI color codes for styling
const colors = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

// ANSI escape codes for cursor control
const cursor = {
    hide: '\x1b[?25l',
    show: '\x1b[?25h',
    up: (n = 1) => `\x1b[${n}A`,
    down: (n = 1) => `\x1b[${n}B`,
    clearLine: '\x1b[2K',
    moveToStart: '\x1b[G'
};

function printHeader() {
    console.log(colors.cyan + colors.bold);
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║         🤖 AUTONOMOUS SOFTWARE AGENTS PROJECT 🤖        ║');
    console.log('║                   Team: Descanta Bauchi                 ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log(colors.reset);
}

function question(prompt) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(colors.yellow + '> ' + colors.reset + prompt, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

function interactiveSelect(title, options) {
    return new Promise((resolve) => {
        let selectedIndex = 0;
        let isFirstRender = true;
        
        // Setup raw input mode
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        
        // Hide cursor
        process.stdout.write(cursor.hide);
        
        function renderMenu() {
            // Clear previous menu (skip on first render)
            if (!isFirstRender) {
                // Calculate total lines: empty line + title + options + instructions
                const totalLines = 1 + 1 + options.length + 2;
                
                // Move cursor up and clear each line
                for (let i = 0; i < totalLines; i++) {
                    process.stdout.write(cursor.up(1) + cursor.clearLine + cursor.moveToStart);
                }
            }
            isFirstRender = false;
            
            // Render the menu
            process.stdout.write('\n'); // Single empty line
            process.stdout.write(colors.blue + title + colors.reset + '\n');
            
            options.forEach((option, index) => {
                const isSelected = index === selectedIndex;
                const prefix = isSelected ? colors.green + '> ' : '  ';
                const color = isSelected ? colors.green + colors.bold : colors.reset;
                
                process.stdout.write(`${prefix}${color}${option}${colors.reset}\n`);
            });
            
            process.stdout.write('\n' + colors.yellow + 'Use ↑/↓ arrows to navigate, Enter to select' + colors.reset + '\n');
        }
        
        function cleanup() {
            process.stdout.write(cursor.show);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeAllListeners('data');
        }
        
        // Initial render
        renderMenu();
        
        // Handle keyboard input
        process.stdin.on('data', (key) => {
            const keyCode = key.toString();
            
            switch (keyCode) {
                case '\u001b[A': // Up arrow
                    selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
                    renderMenu();
                    break;
                    
                case '\u001b[B': // Down arrow
                    selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
                    renderMenu();
                    break;
                    
                case '\r': // Enter
                case '\n':
                    cleanup();
                    console.log(colors.green + `\n✅ Selected: ${options[selectedIndex]}` + colors.reset);
                    resolve(selectedIndex);
                    break;
                    
                case '\u0003': // Ctrl+C
                    cleanup();
                    console.log(colors.red + '\n\n❌ Operation cancelled' + colors.reset);
                    process.exit(0);
                    break;
            }
        });
    });
}

async function selectServer() {
    const options = [
        'https://deliveroojs25.azurewebsites.net',
        'https://deliveroojs.rtibdi.disi.unitn.it',
        'http://localhost:4001'
    ];
    
    const selectedIndex = await interactiveSelect('🌐 Select the server to connect to:', options);
    return options[selectedIndex];
}

async function getManualTokens() {
    const numAgents = await question('\n🔢 How many agents do you want to spawn? ');
    const agentCount = parseInt(numAgents);
    
    if (isNaN(agentCount) || agentCount <= 0) {
        console.log(colors.yellow + '⚠️  Invalid number, defaulting to 1 agent' + colors.reset);
        return await getTokensInput(1);
    }
    
    return await getTokensInput(agentCount);
}

async function getTokensInput(count) {
    const tokens = [];
    console.log(colors.green + `\n🎯 Please enter ${count} token(s):` + colors.reset);
    
    for (let i = 0; i < count; i++) {
        const token = await question(`Token ${i + 1}: `);
        if (token.trim()) {
            tokens.push(token.trim());
        } else {
            console.log(colors.yellow + '⚠️  Empty token, skipping...' + colors.reset);
            i--; // Retry this iteration
        }
    }
    
    return tokens;
}

async function spawnAgents(tokens, serverUrl) {
    console.log(colors.green + `\n🚀 Spawning ${tokens.length} agent(s) on ${serverUrl}...` + colors.reset);
    
    config.host = serverUrl;
    
    tokens.forEach((token, index) => {
        console.log(colors.magenta + `   Agent ${index + 1} starting with token: ${token.substring(0, 8)}...` + colors.reset);
        new Agent(token);
    });
    
    console.log(colors.green + colors.bold + '\n✅ All agents deployed successfully!' + colors.reset);
    console.log(colors.cyan + '📊 Agents are now operating autonomously...\n' + colors.reset);
}

async function selectPDDLMode() {
    const options = [
        'Use A* pathfinding (default)',
        'Use PDDL planner for pathfinding'
    ];
    
    const selectedIndex = await interactiveSelect('🧠 Select pathfinding mode:', options);
    return selectedIndex === 1; // Return true for PDDL mode
}

async function updatePDDLConfig(usePDDL) {
    try {
        utils.setUsePDDLPlanner(usePDDL);
        console.log(colors.green + `✅ PDDL planner ${usePDDL ? 'enabled' : 'disabled'}` + colors.reset);
    } catch (error) {
        console.error(colors.red + '❌ Error updating PDDL config:', error.message + colors.reset);
    }
}

async function main() {
    printHeader();
    
    try {
        const serverUrl = await selectServer();
        const usePDDL = await selectPDDLMode();
        await updatePDDLConfig(usePDDL);
        const tokens = await getManualTokens();
        await spawnAgents(tokens, serverUrl);
        
    } catch (error) {
        console.error(colors.yellow + '❌ Error during setup:', error.message + colors.reset);
    }
}

main();