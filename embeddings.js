const { chunkTokens, fetchTitlesAndAbbreviations } = require('./utils');
const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require("openai");
const { get_encoding } = require('@dqbd/tiktoken');

// Set up OpenAI configuration
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const delimiter = '|';
const directoryPath = path.join(__dirname, 'processed');
if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath);
}
const csvFilePath = path.join(directoryPath, 'embeddings.csv');

(async () => {
    // Step 1: Scrape abbreviation data and save to processed/abbreviations.csv
    await fetchTitlesAndAbbreviations();

    // Step 2: Tokenize the scraped abbreviation data
    const filePath = path.join(__dirname, 'processed', 'abbreviations.csv');
    const data = fs.readFileSync(filePath, 'utf8');
    const tokenizer = get_encoding("cl100k_base");
    const [headers, ...rows] = data.split('\n').map(row => row.split(','));

    const abbreviations = [];
    for (const row of rows) {
        const title = row[0];
        const abbreviation = row[1];
        if (!abbreviation) {
            continue;
        }
        const tokens = tokenizer.encode(abbreviation);

        abbreviations.push({
            title,
            abbreviation,
            tokens,
        });
    }

    // Step 3: Chunk token to max of 8191, as required by OpenAI API
    const chunkedAbbreviations = [];
    const chunkedTokenSize = 1000; // Changed to 1000 as OpenAI has reduced the limit from 8191 to 4096 tokens
    for (const abbreviation of abbreviations) {
        const tokenLength = abbreviation.tokens.length;
        if (tokenLength > chunkedTokenSize) {
            const shortenedAbbreviations = chunkTokens(abbreviation.abbreviation, chunkedTokenSize, tokenizer);
            for (const shortenedAbbreviation of shortenedAbbreviations) {
                chunkedAbbreviations.push({
                    ...abbreviation,
                    abbreviation: shortenedAbbreviation,
                    tokens: tokenizer.encode(shortenedAbbreviation)
                });
            }
        } else {
            chunkedAbbreviations.push(abbreviation);
        }
    }

    // Step 4: Create embeddings from tokens using OpenAI API
    const abbreviationArray = chunkedAbbreviations.map(abbreviation => abbreviation.abbreviation);
    const embeddingsFromAPI = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: abbreviationArray,
    });

    const embeddingsData = embeddingsFromAPI.data.data;
    const finalEmbeddings = [];
    for (let i = 0; i < chunkedAbbreviations.length; i++) {
        const abbreviation = chunkedAbbreviations[i];
        const embeddingStr = embeddingsData[i].embedding.join(delimiter);   // serailize embedding elements with delimiter '|'
        finalEmbeddings.push(`${abbreviation.title},${abbreviation.abbreviation},${embeddingStr}\n`);
    }

    const csvHeaders = 'Title,Abbreviation,Embedding\n';
    const csvContent = csvHeaders + finalEmbeddings.join('');
    fs.writeFileSync(csvFilePath, csvContent);

})();
