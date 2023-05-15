const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require("openai");
const { get_encoding } = require('@dqbd/tiktoken');
const similarity = require('compute-cosine-similarity');
const { App } = require('@slack/bolt');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});


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

// Initialize Slack App with signing secret and token
const app = new App({
    token: process.env.SLACK_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});


app.event('app_mention', async ({ event, context }) => {
    const query = event.text.split(' ').slice(1).join(' '); // Remove the bot name

    const queryResponse = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: query,
    });
    const queryEmbeddings = queryResponse.data.data[0].embedding;

    // ... continue with your embedding calculation ...
     // Step 5: read embedding from csv and use it to calculate cosine distance
     const embeddingCsv = fs.readFileSync(csvFilePath, 'utf8');
     const embeddingRows = embeddingCsv.trim().split('\n').slice(1); // remove header row
     const embeddings = embeddingRows.map(row => {
         const [title, abbreviation, embedding] = row.split(',');
         return {
             title,
             abbreviation,
             embedding: embedding.split(delimiter).map(Number)   // deserialize embedding and convert to number
         };
     });
 
     const tokenizer = get_encoding("cl100k_base");
     const embeddingsWithCosineDistanceSorted = embeddings.map(row => {
         return {
             ...row,
             tokensCount: tokenizer.encode(row.abbreviation).length,
             distance: 1 - similarity(row.embedding, queryEmbeddings),
             // cosine distance is 1-cos_similarity
         }
     }).sort((a, b) => a.distance - b.distance); // sort by distance in ascending order
 
     // Step 6: Combine the rows with the closest cosine distance up to max tokens length
     const maxTokensLength = 2500;
     let currTokensLength = 0;
     let abbreviationConext = "";
 
     for (let i = 0; i < embeddingsWithCosineDistanceSorted.length && currTokensLength < maxTokensLength; i++) {
         const cosineDistanceRow = embeddingsWithCosineDistanceSorted[i];
         currTokensLength += cosineDistanceRow.tokensCount;
         if (currTokensLength < maxTokensLength) {
             abbreviationConext += `\n${cosineDistanceRow.abbreviation}`;
         }
     }
    // Output result through Slack bot
    const response = await openai.createCompletion({
        model: "gpt-3.5-turbo-instruct",
        prompt: `Answer the question based on the context below. The context is derived from information about various car aspects, including Volvo cars, car hardware, software in cars etc. Provide detailed answers about vehicle features, systems, and car technologies. If the question can't be answered based on the context, say "I don't know"\n\nContext: ${abbreviationConext}\n\n---\n\nQuestion: ${query}\nAnswer:`,
        max_tokens: 150,
        temperature: 0.5,
        presence_penalty: 0,
        frequency_penalty: 0,
        best_of: 1,
    });

    try {
        await app.client.chat.postMessage({
            token: context.botToken,
            channel: event.channel,
            text: response.data.choices[0].text,
        });
    } catch (error) {
        console.log(`Error responding to message: ${error}`);
    }
});

(async () => {
    // start your slack app
    await app.start(process.env.PORT || 3000);
    console.log('Slack bot is running.');
})();