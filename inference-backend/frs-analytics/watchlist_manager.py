import logging
import time
import requests
import numpy as np
from urllib.parse import urljoin
from typing import List, Dict, Tuple, Optional

logger = logging.getLogger(__name__)

class WatchlistManager:
    def __init__(self, api_config: Dict):
        self.api_config = api_config
        self.base_url = api_config.get('base_url')
        self.token = api_config.get('token')
        self.persons: List[Dict] = []
        self.last_update = 0
        self.update_interval = 60.0 # seconds
        self.match_threshold = api_config.get('match_threshold', 0.30)  # Lowered for law enforcement use - reduces false negatives

    def is_empty(self) -> bool:
        """Returns True if the watchlist is currently empty."""
        return len(self.persons) == 0

    def update(self):
        """Update the watchlist from the API."""
        if time.time() - self.last_update < self.update_interval and self.persons:
            return

        try:
            url = urljoin(self.base_url, '/api/inference/frs/persons')
            headers = {'Authorization': f'Bearer {self.token}'} if self.token else {}
            resp = requests.get(url, headers=headers, timeout=5)
            
            if resp.status_code == 200:
                new_persons = resp.json()
                valid_persons = []
                for p in new_persons:
                    # Parse embeddings (new multi-embedding format)
                    embeddings_data = p.get('embeddings')
                    
                    # Fallback to single embedding for backward compatibility
                    if not embeddings_data and 'embedding' in p and p['embedding']:
                        embeddings_data = [p['embedding']]
                    
                    if embeddings_data:
                        try:
                            # Store embeddings as list (already in correct format from API)
                            p['embeddings'] = embeddings_data
                            
                            # Also keep embedding_np for backward compatibility
                            if 'embedding' in p and p['embedding']:
                                p['embedding_np'] = np.array(p['embedding'], dtype=np.float32)
                            
                            valid_persons.append(p)
                        except Exception as e:
                            logger.error(f"Error parsing embeddings for person {p.get('name')}: {e}")
                
                self.persons = valid_persons
                person_names = [p.get('name', 'Unknown') for p in self.persons]
                total_embeddings = sum(len(p.get('embeddings', [])) for p in self.persons)
                logger.info(f"Updated watchlist: {len(self.persons)} persons loaded with {total_embeddings} total embeddings: {', '.join(person_names)}")
            else:
                # Suppress repetitive error logs
                if not hasattr(self, '_last_error_log'):
                    self._last_error_log = 0
                current_time = time.time()
                if current_time - self._last_error_log >= 60:
                    logger.error(f"Failed to fetch watchlist: {resp.status_code} - {resp.text}")
                    self._last_error_log = current_time
                
            self.last_update = time.time()
            
        except Exception as e:
            # Suppress repetitive connection errors - only log once per minute
            if not hasattr(self, '_last_error_log'):
                self._last_error_log = 0
            current_time = time.time()
            if current_time - self._last_error_log >= 60:
                logger.warning(f"Watchlist fetch error (will retry): {e}")
                self._last_error_log = current_time
            # Wait regular interval to avoid hammering if backend is down
            self.last_update = time.time()
 

    def match(self, face_embedding: List[float]) -> Tuple[Optional[Dict], float]:
        """
        Match a face embedding against the watchlist.
        Now checks ALL embeddings for each person (multi-angle support).
        Returns: (person_dict, score) or (None, 0.0)
        """
        if not face_embedding or not self.persons:
            # If no embeddings or empty watchlist, cannot match
            return None, 0.0
            
        best_match = None
        best_score = 0.0
        
        target_emb = np.array(face_embedding, dtype=np.float32)
        target_norm = np.linalg.norm(target_emb)
        
        if target_norm == 0:
            return None, 0.0
        
        for person in self.persons:
            # Get all embeddings for this person
            embeddings_list = person.get('embeddings')
            
            # Fallback to single embedding if embeddings array not available (backward compat)
            if not embeddings_list:
                if 'embedding_np' in person:
                    embeddings_list = [person['embedding_np']]
                else:
                    continue
            
            # Check against ALL embeddings for this person
            for emb_data in embeddings_list:
                # Convert to numpy if needed
                if isinstance(emb_data, list):
                    source_emb = np.array(emb_data, dtype=np.float32)
                elif isinstance(emb_data, np.ndarray):
                    source_emb = emb_data
                else:
                    continue
                
                source_norm = np.linalg.norm(source_emb)
                
                if source_norm == 0:
                    continue
                
                # Cosine similarity
                score = np.dot(target_emb, source_emb) / (target_norm * source_norm)
                
                if score > best_score:
                    best_score = score
                    best_match = person
                
        # Use configured threshold or default
        threshold = self.match_threshold
        
        # Log near misses for debugging if score is close
        if best_score > 0.25 and best_score < threshold:
             logger.info(f"Near miss: {best_match.get('name', 'Unknown')} ({best_score:.3f} < {threshold})")
        elif best_score > 0.0:
             logger.info(f"Best face score: {best_match.get('name', 'Unknown') if best_match else 'none'} = {best_score:.3f} (threshold={threshold})")

        if best_score >= threshold:
            return best_match, float(best_score)
            
        return None, 0.0
