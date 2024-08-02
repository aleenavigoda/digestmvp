import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts"
import 'https://deno.land/x/xhr@0.2.1/mod.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4.52.7'
import { getEncoding } from 'https://esm.sh/js-tiktoken@1.0.12'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

console.log("recommend-essays function starting...")

async function getEmbedding(text) {
  console.log("Getting embedding for text:", text.substring(0, 100) + "...") // Log first 100 chars
  const openai = new OpenAI({
    apiKey: Deno.env.get('OPENAI_API_KEY')
  });

  try {
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    })
    const [{ embedding }] = embeddingResponse.data
    console.log("Embedding generated successfully")
    return embedding;
  } catch (error) {
    console.error("Error generating embedding:", error)
    throw error;
  }
}

Deno.serve(async (req) => {
  console.log("Request received")
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { title, description } = await req.json()

    const input = `${title} ${description}`.replace(/\n/g, ' ')
    
    const supabaseurl = Deno.env.get('BASE_URL')
    const servicerolekey = Deno.env.get('SERVICE_ROLE_KEY')
    
    const client = createClient(supabaseurl, servicerolekey);

    const embedding = await getEmbedding(input)

    const { data: documents, error } = await client.rpc('match_essays', {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: 10,
    })

    if (error) {
      console.error("Error in match_essays RPC:", error)
      throw error
    }

    // console.log("Matched documents:", documents ? documents.length : 'null')

    if (!documents || documents.length === 0) {
      return new Response(JSON.stringify({ message: "No matching essays found" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404
      })
    }

    const formattedDocuments = documents.map(document => ({
      id
      title: document.title,
      url: document.essay_url
    }))

    return new Response(JSON.stringify(formattedDocuments), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error("Error in recommend-essays function:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})