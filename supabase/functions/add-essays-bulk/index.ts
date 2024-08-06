import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts"
import 'https://deno.land/x/xhr@0.2.1/mod.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4.52.7'
import { getEncoding } from 'https://esm.sh/js-tiktoken@1.0.12'
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function calculateAverageEmbedding(embeddings) {
  if (embeddings.length === 0) {
    return [];
  }
  
  const numDimensions = embeddings[0].length;
  const sumEmbedding = new Array(numDimensions).fill(0);
  
  for (const embedding of embeddings) {
    for (let i = 0; i < numDimensions; i++) {
      sumEmbedding[i] += embedding[i];
    }
  }
  
  return sumEmbedding.map(sum => sum / embeddings.length);
}

async function chonker(text, chunkSize = 8192, overlapSize = 100) {
  const encoding = getEncoding('cl100k_base');
  const tokens = encoding.encode(text);
  const openai = new OpenAI({
    apiKey: Deno.env.get('OPENAI_API_KEY')
  });
  
  const chunks = [];
  for (let i = 0; i < tokens.length; i += chunkSize - overlapSize) {
    const chunkTokens = tokens.slice(i, i + chunkSize);
    chunks.push(encoding.decode(chunkTokens));  
  }

  let embeddings = []

  for (const chunk of chunks) {
    const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunk
    })
    const [{ embedding }] = embeddingResponse.data
    embeddings.push(embedding);
  }

  return calculateAverageEmbedding(embeddings);
}

async function processEssay(url, client) {
  const response = await fetch(url);
  const content = await response.text();
  const $ = cheerio.load(content);
  const title = $('title').first().text();

  const input = content.replace(/\n/g, ' ')
  const embedding = await chonker(input, 2000)

  const { data, error } = await client.from('Essays').insert({
    title,
    essay_url: url,
    content,
    embedding,
    essay_img_url: null // You might want to extract this from the content if available
  }).select()

  if (error) {
    console.error(`Error inserting essay ${url}:`, error)
    return null
  }

  return data[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      urls, 
      bookshelfId,
      shelfName
    } = await req.json()
    
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('Invalid or empty URLs array')
    }

    if (!bookshelfId || !shelfName) {
      throw new Error('bookshelfId and shelfName are required')
    }

    const supabaseurl = Deno.env.get('BASE_URL')
    const servicerolekey = Deno.env.get('SERVICE_ROLE_KEY')
    const client = createClient(supabaseurl, servicerolekey);

    // Process essays in parallel
    const essayPromises = urls.map(url => processEssay(url, client))
    const essays = await Promise.all(essayPromises)

    // Filter out any null values (failed insertions)
    const validEssays = essays.filter(essay => essay !== null)

    // Insert into bookshelf_essays table
    const bookshelfEssays = validEssays.map(essay => ({
      bookshelf_id: bookshelfId,
      essay_id: essay.id,
      essay_title: essay.title,
      bookshelf_name: shelfName
    }))

    const { error: linkError } = await client
      .from('bookshelf_essays')
      .insert(bookshelfEssays)

    if (linkError) {
      throw new Error(`Error linking essays to bookshelf: ${linkError.message}`)
    }

    return new Response(JSON.stringify({
      message: "Essays added successfully",
      addedEssays: validEssays.length,
      bookshelfId,
      shelfName
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in add-essays-bulk:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})