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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url, bookshelfId, shelfName } = await req.json()

    if (!url) {
      throw new Error('URL is required')
    }

    if (!bookshelfId || !shelfName) {
      throw new Error('bookshelfId and shelfName are required')
    }

    const response = await fetch(url);
    const content = await response.text();
    const $ = cheerio.load(content);
    const title = $('title').first().text();

    const input = content.replace(/\n/g, ' ')
    const embedding = await chonker(input, 2000)

    const supabaseurl = Deno.env.get('BASE_URL')
    const servicerolekey = Deno.env.get('SERVICE_ROLE_KEY')
    const client = createClient(supabaseurl, servicerolekey);

    const { data: essay, error: createError } = await client.from('Essays').insert({
      title,
      essay_url: url,
      content,
      embedding,
    }).select()

    if (createError) {
      throw new Error(`Error inserting essay: ${createError.message}`)
    }

    // Link essay to bookshelf
    const { error: linkError } = await client.from('bookshelf_essays').insert({
      bookshelf_id: bookshelfId,
      essay_id: essay[0].id,
      essay_title: essay[0].title,
      bookshelf_name: shelfName
    })

    if (linkError) {
      throw new Error(`Error linking essay to bookshelf: ${linkError.message}`)
    }

    return new Response(JSON.stringify({
      message: "Essay processed and linked to bookshelf",
      essayId: essay[0].id,
      title: essay[0].title,
      bookshelfId,
      shelfName
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in function:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})