const authLabels = {
    deepseek: document.getElementById('auth-deepseek'),
    doubao: document.getElementById('auth-doubao'),
}
const providerInputs = [...document.querySelectorAll('input[name="provider"]')]
const thinkingInput = document.getElementById('thinking')
const versionLabel = document.getElementById('version')

function renderStatus(status) {
    versionLabel.textContent = `v${status.version || '?'}`
    for (const input of providerInputs) {
        input.checked = input.value === status.provider
    }
    thinkingInput.checked = status.thinking === true
    for (const [id, element] of Object.entries(authLabels)) {
        const result = status.auth?.[id]
        if (!result) {
            element.textContent = '未知'
            element.className = 'auth-msg'
            continue
        }
        element.textContent = result.message
        element.className = `auth-msg ${result.ok ? 'ok' : 'bad'}`
    }
}

async function loadStatus() {
    try {
        const status = await chrome.runtime.sendMessage({ type: 'popup-status' })
        renderStatus(status || {})
    }
    catch {
        versionLabel.textContent = '后台不可用'
    }
}

async function saveSettings(patch) {
    await chrome.storage.local.set(patch).catch(() => {})
}

providerInputs.forEach((input) => {
    input.addEventListener('change', () => {
        if (input.checked)
            saveSettings({ provider: input.value })
    })
})

thinkingInput.addEventListener('change', () => {
    saveSettings({ thinking: thinkingInput.checked })
})

document.getElementById('recheck').addEventListener('click', loadStatus)

loadStatus()
