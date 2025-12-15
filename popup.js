// Load and display user email from storage
chrome.storage.local.get('yaxis_user', (data) => {
    const userIcon = document.getElementById('user-icon');
    const tooltip = document.getElementById('user-tooltip');
    
    if (data.yaxis_user && data.yaxis_user.email) {
        tooltip.textContent = data.yaxis_user.email;
        userIcon.style.display = 'flex';
    } else {
        userIcon.style.display = 'none';
    }
});
