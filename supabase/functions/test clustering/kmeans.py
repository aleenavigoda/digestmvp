import numpy as np
from supabase import create_client, Client
from sklearn.cluster import KMeans
import ast  # For safely converting strings to lists

# Initialize the Supabase client
url = "https://ctyrqfzockxyqoughgqv.supabase.co"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0eXJxZnpvY2t4eXFvdWdoZ3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjEwODU5MjksImV4cCI6MjAzNjY2MTkyOX0.8wo7JoGmshWAiJCFKysRAyjPMBLU5KfdoZwy7ST4D3E"
supabase: Client = create_client(url, key)

# Fetch the embeddings from your Supabase database
def fetch_embeddings():
    response = supabase.table('Essays').select('embedding').execute()
    
    embeddings = []
    for record in response.data:
        embedding_str = record['embedding']
        if embedding_str is not None:
            try:
                embedding = ast.literal_eval(embedding_str)
                embeddings.append(embedding)
            except (ValueError, SyntaxError) as e:
                print(f"Skipping malformed embedding: {embedding_str} - Error: {e}")

    return np.array(embeddings)  # Convert to NumPy array

# Assuming you want to cluster your embeddings
def cluster_embeddings(embeddings):
    num_clusters = 5  # Adjust the number of clusters as needed
    kmeans = KMeans(n_clusters=num_clusters, random_state=0)
    clusters = kmeans.fit_predict(embeddings)
    return clusters

# Fetch embeddings from the database
embeddings = fetch_embeddings()

# Run K-Means clustering on the embeddings
clusters = cluster_embeddings(embeddings)

# Print or save the cluster assignments
print(clusters)