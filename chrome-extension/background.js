// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

// Handle script injection requests from side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractContactData') {
        chrome.scripting.executeScript({
            target: { tabId: request.tabId },
            func: extractContactData
        }).then(results => {
            sendResponse({ success: true, data: results[0]?.result });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // Indicates we will send a response asynchronously
    }
});

// Function to extract contact data (runs in page context)
function extractContactData() {
    const data = {};

    // Extract Full Name
    const nameElement = document.querySelector('.contact-column__name');
    if (nameElement) {
        data.fullName = nameElement.textContent.trim();
    }

    // Extract Address
    const addressDetails = document.querySelector('.address__details');
    if (addressDetails) {
        const addressParts = [];
        const paragraphs = addressDetails.querySelectorAll('p');
        paragraphs.forEach(p => {
            const text = p.textContent.trim();
            // Skip "Primary" label, but include county
            if (text && text !== 'Primary') {
                addressParts.push(text);
            }
        });
        // Join all parts with two spaces (replacing any line breaks)
        if (addressParts.length > 0) {
            data.address = addressParts.join('  '); // Two spaces between parts
        }
    }

    // Extract Phone
    const phoneLink = document.querySelector('a[href^="tel:"]');
    if (phoneLink) {
        const phoneSpan = phoneLink.querySelector('span[data-test-element="phone-numbers_number_0"]');
        if (phoneSpan) {
            data.phone = phoneSpan.textContent.trim();
        } else {
            // Fallback: extract from href
            const href = phoneLink.getAttribute('href');
            if (href) {
                const phoneMatch = href.match(/tel:\+?(\d+)/);
                if (phoneMatch) {
                    const digits = phoneMatch[1];
                    // Format as (XXX) XXX-XXXX
                    if (digits.length === 10) {
                        data.phone = `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
                    } else {
                        data.phone = digits;
                    }
                }
            }
        }
    }

    return data;
}

