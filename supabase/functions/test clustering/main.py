from sklearn.datasets import fetch_20newsgroups
newsgroups_train = fetch_20newsgroups(subset='train')
print(f"Number of samples: {len(newsgroups_train.data)}")
print(f"Number of categories: {len(newsgroups_train.target_names)}")
print(f"Categories: {newsgroups_train.target_names}")