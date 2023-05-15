const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const abbreviationsUrl = 'https://d5t5.com/wiki/wiki/article-abbreviations';

async function fetchTitlesAndAbbreviations() {
    const browser = await puppeteer.launch({
        headless: false,
        args: ["--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Navigate to the abbreviation page
    await page.goto(abbreviationsUrl);

    // Wait for the page to load
    await page.waitForSelector('article span[itemprop="articleBody"]');

    // Extract the abbreviations and their meanings
    const abbreviations = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('article span[itemprop="articleBody"] p'));
        return nodes.map(node => {
            const title = node.querySelector('strong')?.textContent.trim();
            const abbreviation = node.textContent.replace(title, '').trim();
            return {
                title: title,
                abbreviation: abbreviation,
            };
        }).filter(ab => ab.title && ab.abbreviation);  // Remove any empty entries
    });

    await browser.close();

    // Create the 'processed' directory if it doesn't exist
    const directoryPath = path.join(__dirname, 'processed');
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath);
    }

    // Write the data to a CSV file using the fs package
    const csvFilePath = path.join(directoryPath, 'abbreviations.csv');
    const csvHeaders = 'Title,Abbreviation\n';
    const csvContent = csvHeaders + abbreviations.map(ab => `"${ab.title}","${ab.abbreviation}"`).join('\n');
    fs.writeFileSync(csvFilePath, csvContent);
}

function pruneString(str) {
    return str.replace(/[\t\n]/g, ' ')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function chunkTokens(text, maxTokens, tokenizer) {
    // Split the text into sentences
    const sentences = text.split('. ');

    const chunks = [];
    let tokensSoFar = 0;
    let chunk = [];

    // Loop through the sentences
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const tokenLength = tokenizer.encode(" " + sentence).length;

        // If the number of tokens so far plus the number of tokens in the current sentence is greater
        // than the max number of tokens, then add the chunk to the list of chunks and reset
        // the chunk and tokens so far
        if (tokensSoFar + tokenLength > maxTokens) {
            chunks.push(chunk.join('. ') + '.');
            chunk = [];
            tokensSoFar = 0;
        }

        // If the number of tokens in the current sentence is greater than the max number of
        // tokens, go to the next sentence and skip the sentence
        if (tokenLength > maxTokens) {
            continue;
        }

        // Otherwise, add the sentence to the chunk and add the number of tokens to the total
        chunk.push(sentence);
        tokensSoFar += tokenLength + 1;
    }

    // Add the last chunk
    if (chunk.length > 0) {
        chunks.push(chunk.join('. ') + '.');
    }

    return chunks;
}

module.exports = {
    chunkTokens,
    fetchTitlesAndAbbreviations,
};
